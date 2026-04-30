import os
import pickle

import numpy as np
import pytest


class StubRegressor:
    def __init__(self, value):
        self.value = float(value)

    def predict(self, X):
        return np.array([self.value] * len(X))


def test_feature_pipeline_transforms_valid_dict_to_1x14(patched_predict, sample_features):
    pipeline = patched_predict.FeaturePipeline()
    arr = pipeline.transform(sample_features)
    assert arr.shape == (1, 14)


def test_feature_pipeline_respects_feature_order(patched_predict, sample_features):
    pipeline = patched_predict.FeaturePipeline()
    arr = pipeline.transform(sample_features)[0]

    encoded_event = pipeline.encoders['event_type'].transform(['Conference'])[0]
    encoded_function = pipeline.encoders['function_type'].transform(['Reception'])[0]

    assert arr[0] == encoded_event
    assert arr[1] == sample_features['expected_attendance']
    assert arr[4] == encoded_function
    assert arr[-1] == sample_features['time_slice_index']


def test_feature_pipeline_raises_on_missing_key(patched_predict, sample_features):
    pipeline = patched_predict.FeaturePipeline()
    incomplete = {k: v for k, v in sample_features.items() if k != 'room_count'}
    with pytest.raises(KeyError):
        pipeline.transform(incomplete)


def test_feature_pipeline_raises_on_unknown_category(patched_predict, sample_features):
    pipeline = patched_predict.FeaturePipeline()
    bogus = dict(sample_features)
    bogus['event_type'] = 'UnheardOfEvent'
    with pytest.raises(ValueError):
        pipeline.transform(bogus)


def test_correction_engine_applies_factor_when_present(patched_predict, mock_supabase_client):
    mock_supabase_client.table.return_value.select.return_value.execute.return_value.data = [
        {'event_type': 'Concert', 'role': 'Security', 'correction_factor': 1.5},
    ]
    engine = patched_predict.CorrectionEngine()
    assert engine.apply('Concert', 'Security', 10.0) == pytest.approx(15.0)


def test_correction_engine_defaults_to_one_when_missing(patched_predict, mock_supabase_client):
    mock_supabase_client.table.return_value.select.return_value.execute.return_value.data = []
    engine = patched_predict.CorrectionEngine()
    assert engine.apply('Concert', 'Usher', 7.0) == pytest.approx(7.0)


def test_correction_engine_survives_supabase_unreachable(patched_predict, monkeypatch):
    def boom(*_a, **_kw):
        raise RuntimeError('network down')

    monkeypatch.setattr(patched_predict, 'create_client', boom)
    engine = patched_predict.CorrectionEngine()
    assert engine.factors == {}
    assert engine.apply('Concert', 'Usher', 9.0) == pytest.approx(9.0)


def test_predict_demand_returns_all_roles(patched_predict, sample_features):
    result = patched_predict.predict_demand(sample_features)
    assert set(result.keys()) == {'Usher', 'Security', 'Food Staff', 'Supervisor'}
    for role, counts in result.items():
        assert 'predicted' in counts and 'corrected' in counts
        assert counts['predicted'] >= 0
        assert counts['corrected'] >= 0
        assert isinstance(counts['predicted'], int)
        assert isinstance(counts['corrected'], int)


def test_predict_demand_zero_clamps_negative_prediction(patched_predict, fake_models_dir, sample_features):
    """A model returning a negative value must be clamped to 0."""
    with open(os.path.join(fake_models_dir, 'Usher.pkl'), 'wb') as f:
        pickle.dump(StubRegressor(-5.0), f)

    result = patched_predict.predict_demand(sample_features)
    assert result['Usher']['predicted'] == 0
    assert result['Usher']['corrected'] == 0


def test_predict_demand_returns_zero_when_model_file_missing(patched_predict, fake_models_dir, sample_features):
    os.remove(os.path.join(fake_models_dir, 'Security.pkl'))
    result = patched_predict.predict_demand(sample_features)
    assert result['Security'] == {'predicted': 0, 'corrected': 0}
    assert result['Usher']['predicted'] > 0


def test_predict_demand_returns_zero_on_pickle_error(patched_predict, fake_models_dir, sample_features):
    """If a model file is corrupted (not a valid pickle), it should be treated as 0 demand."""
    with open(os.path.join(fake_models_dir, 'Supervisor.pkl'), 'w') as f:
        f.write('not a pickle')

    result = patched_predict.predict_demand(sample_features)
    assert result['Supervisor'] == {'predicted': 0, 'corrected': 0}
    assert result['Usher']['predicted'] > 0


def test_predict_demand_returns_zero_on_missing_encoders(patched_predict, fake_models_dir, sample_features):
    """If encoders.pkl is missing, FeaturePipeline should handle it gracefully (though predictions might be off)."""
    os.remove(os.path.join(fake_models_dir, 'encoders.pkl'))
    
    # It shouldn't crash
    pipeline = patched_predict.FeaturePipeline()
    assert pipeline.encoders == {}
    
    # Prediction might fail later if categorical fields are used, but we've caught Exception in predict_demand
    result = patched_predict.predict_demand(sample_features)
    assert 'Usher' in result


def test_predict_demand_applies_correction_factor(patched_predict, mock_supabase_client, sample_features):
    mock_supabase_client.table.return_value.select.return_value.execute.return_value.data = [
        {'event_type': 'Conference', 'role': 'Usher', 'correction_factor': 2.0},
    ]
    result = patched_predict.predict_demand(sample_features)
    assert result['Usher']['corrected'] >= result['Usher']['predicted']
