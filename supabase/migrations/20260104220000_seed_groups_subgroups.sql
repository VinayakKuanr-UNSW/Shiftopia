/*
  # Seed Standard Groups and Sub-Groups

  This migration ensures consistent Groups and Sub-Groups across the system:
  
  ## Groups
  - Convention Centre (Blue)
  - Exhibition Centre (Green)
  - Theatre (Red)

  ## Sub-Groups
  - Convention Centre: AM Base, AM Assist, PM Base, PM Assist, Graveyard, DHT-Set, DHT-Pack
  - Exhibition Centre: Bump-In, Bump-Out
  - Theatre: Setup, Setup Assist, Packdown, Packdown Assist
*/

DO $$
DECLARE
  v_convention_group_id uuid;
  v_exhibition_group_id uuid;
  v_theatre_group_id uuid;
BEGIN
  -- Clear existing groups (CASCADE will delete subgroups)
  DELETE FROM shift_groups;

  -- Insert Convention Centre group
  INSERT INTO shift_groups (name)
  VALUES ('Convention Centre')
  RETURNING id INTO v_convention_group_id;

  -- Insert Exhibition Centre group
  INSERT INTO shift_groups (name)
  VALUES ('Exhibition Centre')
  RETURNING id INTO v_exhibition_group_id;

  -- Insert Theatre group
  INSERT INTO shift_groups (name)
  VALUES ('Theatre')
  RETURNING id INTO v_theatre_group_id;

  -- Insert Convention Centre sub-groups
  INSERT INTO shift_subgroups (group_id, name) VALUES
    (v_convention_group_id, 'AM Base'),
    (v_convention_group_id, 'AM Assist'),
    (v_convention_group_id, 'PM Base'),
    (v_convention_group_id, 'PM Assist'),
    (v_convention_group_id, 'Graveyard'),
    (v_convention_group_id, 'DHT-Set'),
    (v_convention_group_id, 'DHT-Pack');

  -- Insert Exhibition Centre sub-groups
  INSERT INTO shift_subgroups (group_id, name) VALUES
    (v_exhibition_group_id, 'Bump-In'),
    (v_exhibition_group_id, 'Bump-Out');

  -- Insert Theatre sub-groups
  INSERT INTO shift_subgroups (group_id, name) VALUES
    (v_theatre_group_id, 'Setup'),
    (v_theatre_group_id, 'Setup Assist'),
    (v_theatre_group_id, 'Packdown'),
    (v_theatre_group_id, 'Packdown Assist');

  RAISE NOTICE 'Successfully seeded Groups and Sub-Groups';
END $$;
