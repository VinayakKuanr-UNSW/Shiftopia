import pytest


def test_health_endpoint(client):
    r = client.get('/health')
    assert r.status_code == 200
    assert r.json() == {'status': 'ok'}


def test_predict_demand_returns_role_keyed_dict(client, valid_api_payload):
    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {'Usher', 'Security', 'Food Staff', 'Supervisor'}
    for role, counts in body.items():
        assert 'predicted' in counts
        assert 'corrected' in counts
        assert isinstance(counts['predicted'], int)
        assert isinstance(counts['corrected'], int)


def test_predict_demand_without_event_id_skips_insert(client, valid_api_payload, mock_supabase_client):
    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 200
    called_tables = [c.args[0] for c in mock_supabase_client.table.call_args_list]
    assert 'predicted_labor_demand' not in called_tables


def test_predict_demand_with_event_id_attempts_insert(client, valid_api_payload, mock_supabase_client):
    valid_api_payload['event_id'] = 'evt-test-001'
    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 200
    mock_supabase_client.table.assert_called_with('predicted_labor_demand')
    assert mock_supabase_client.table.return_value.insert.call_count == 4


def test_predict_demand_insert_payload_shape(client, valid_api_payload, mock_supabase_client):
    valid_api_payload['event_id'] = 'evt-test-002'
    client.post('/predict/demand', json=valid_api_payload)

    calls = mock_supabase_client.table.return_value.insert.call_args_list
    assert len(calls) == 4
    for call in calls:
        row = call.args[0]
        assert row['event_id'] == 'evt-test-002'
        assert row['role'] in {'Usher', 'Security', 'Food Staff', 'Supervisor'}
        assert row['time_slot'] == valid_api_payload['time_slice_index']
        assert 'predicted_count' in row
        assert 'corrected_count' in row
        assert row['model_version'] == 'v1.0'


def test_predict_demand_missing_field_returns_422(client, valid_api_payload):
    del valid_api_payload['event_type']
    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 422


def test_predict_demand_wrong_type_returns_422(client, valid_api_payload):
    valid_api_payload['expected_attendance'] = 'lots'
    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 422


def test_predict_demand_malformed_json_returns_422(client):
    r = client.post(
        '/predict/demand',
        content='{not json',
        headers={'Content-Type': 'application/json'},
    )
    assert r.status_code == 422


def test_predict_demand_empty_body_returns_422(client):
    r = client.post('/predict/demand', json={})
    assert r.status_code == 422


def test_predict_demand_supabase_failure_does_not_break_response(client, valid_api_payload, monkeypatch):
    import api

    def boom(*_a, **_kw):
        raise RuntimeError('supabase offline')

    monkeypatch.setattr(api, 'create_client', boom)
    valid_api_payload['event_id'] = 'evt-will-fail'
    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 200


def test_predict_demand_missing_env_vars_swallows_error(client, valid_api_payload, monkeypatch):
    """If env vars are missing, create_client might fail, but API should still return predictions."""
    monkeypatch.delenv('VITE_SUPABASE_URL', raising=False)
    monkeypatch.delenv('VITE_SUPABASE_ANON_KEY', raising=False)
    valid_api_payload['event_id'] = 'evt-missing-env'
    
    # We expect it not to crash
    r = client.post('/predict/demand', json=valid_api_payload)
    assert r.status_code == 200
    assert 'Usher' in r.json()
