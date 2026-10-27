import json
import random
import os
import uuid

random.seed(42)

with open('scratch/seed_metadata.json') as f:
    meta = json.load(f)

with open('scratch/seed_roles.json') as f:
    all_roles = json.load(f)

with open('scratch/first_100_users.json') as f:
    first_100 = json.load(f)

org_id = meta['org_id']
departments = meta['departments']
sub_departments = meta['sub_departments']
skills = meta['skills']
licenses = meta['licenses']

subdept_map = {s['id']: s for s in sub_departments}
roles_by_subdept = {}
for r in all_roles:
    s_id = r.get('subdepartment_id')
    if s_id:
        roles_by_subdept.setdefault(s_id, []).append(r)

skills_by_name = {s['name']: s['id'] for s in skills}
licenses_by_name = {l['name']: l['id'] for l in licenses}

# Find subdepartment ID helper
def find_subdept(dept_name, sub_name):
    for s in sub_departments:
        if s['name'].lower() == sub_name.lower():
            d = next((dep for dep in departments if dep['id'] == s['department_id']), None)
            if d and d['name'].lower() == dept_name.lower():
                return s
    return None

# Allocation plan: (dept_name, sub_name, count)
subdept_plan = [
    # Culinary Services (90)
    ('Culinary Services', 'Events & Catering Kitchen', 35),
    ('Culinary Services', 'Kitchen Logistics & Stewarding', 25),
    ('Culinary Services', 'Pastry', 15),
    ('Culinary Services', 'Production Kitchen', 10),
    ('Culinary Services', 'Retail Outlets Kitchen', 5),
    # Event Delivery (100)
    ('Event Delivery', 'Event Food & Beverage', 55),
    ('Event Delivery', 'Retail & Beverage', 35),
    ('Event Delivery', 'F&B Coordination', 10),
    # Events (80)
    ('Events', 'Event Setup', 45),
    ('Events', 'Event Operations', 20),
    ('Events', 'Exhibition Services', 15),
    # Audio Visual Services (60)
    ('Audio Visual Services', 'AV Technical', 25),
    ('Audio Visual Services', 'AV Floor Operations', 15),
    ('Audio Visual Services', 'Staging & Production Crew', 10),
    ('Audio Visual Services', 'Rigging', 10),
    # Customer Services (50)
    ('Customer Services', 'Ushering', 35),
    ('Customer Services', 'Customer Service', 15),
    # Building Services (45)
    ('Building Services', 'Presentation Services', 25),
    ('Building Services', 'Car Park & Logistics', 12),
    ('Building Services', 'Assets & Trades', 8),
    # Security & Risk (35)
    ('Security & Risk', 'Event Security', 20),
    ('Security & Risk', 'Building Security', 10),
    ('Security & Risk', 'First Aid', 5),
    # Live Entertainment (15)
    ('Live Entertainment', 'Live Event Operations', 8),
    ('Live Entertainment', 'Ticketing, Bookings & Merchandise', 7),
    # ICT Services (10)
    ('ICT Services', 'Service Desk & Support', 6),
    ('ICT Services', 'Event Information Systems', 4),
    # People & Culture (5)
    ('People & Culture', 'People Operations & Shared Services', 5),
    # Finance & Administration (5)
    ('Finance & Administration', 'Accounts Payable & Receivable', 3),
    ('Finance & Administration', 'Payroll', 2),
    # Executive Office (5)
    ('Executive Office', 'Executive Support & Reception', 3),
    ('Executive Office', 'Legal & Compliance', 2),
]

# Verify total = 500
total_target = sum(count for _, _, count in subdept_plan)
assert total_target == 500, f"Target sum is {total_target}, expected 500"

# Name pools
first_names = [
    'Liam', 'Olivia', 'Noah', 'Emma', 'Oliver', 'Charlotte', 'Elijah', 'Amelia',
    'Mateo', 'Aria', 'Lucas', 'Mia', 'Kenji', 'Chloe', 'Arjun', 'Aaliyah',
    'Alexander', 'Zoe', 'Wei', 'Grace', 'Tariq', 'Isabella', 'Muhammad', 'Sophie',
    'Jack', 'Maya', 'Aarav', 'Hannah', 'Hugo', 'Harper', 'Ravi', 'Camila',
    'Lachlan', 'Layla', 'Ethan', 'Ella', 'Gabriel', 'Mila', 'Hiroshi', 'Scarlett',
    'Zayn', 'Nora', 'Daniel', 'Victoria', 'Aiden', 'Elena', 'Kavita', 'Freya',
    'Marcus', 'Ivy', 'Yusuf', 'Zara', 'Cooper', 'Ruby', 'Dimitri', 'Audrey',
    'Oscar', 'Priya', 'Leo', 'Fatima', 'Finn', 'Stella', 'Siddharth', 'Aurora',
    'Brodie', 'Leila', 'Hamish', 'Penelope', 'Sora', 'Claire', 'Dev', 'Naomi',
    'Xavier', 'Alice', 'Jian', 'Piper', 'Hamza', 'Violet', 'Fletcher', 'Imogen',
    'Callum', 'Emilia', 'Zubair', 'Maeve', 'Ronan', 'Eliza', 'Suresh', 'Hazel',
    'Ezekiel', 'Georgia', 'Kian', 'Sienna', 'Bao', 'Phoebe', 'Declan', 'Sari',
    'Hassan', 'Billie', 'Caleb', 'Abigail', 'Toby', 'Natasha', 'Kieran', 'Ananya'
]

last_names = [
    'Tremblay', 'Nguyen', 'Patel', 'Kowalski', 'Singh', 'Garcia', 'Chen', 'Rossi',
    'Al-Mansoor', 'O\'Connor', 'Santos', 'Kim', 'Tanaka', 'Muller', 'Johansson', 'Dubois',
    'Sharma', 'Khoury', 'Fernandez', 'Nakamura', 'Okafor', 'Wong', 'Moreau', 'Costa',
    'Popov', 'Ali', 'Yamamoto', 'Gomez', 'Novak', 'Ibrahim', 'Chung', 'Ferrari',
    'Nielsen', 'Alvarez', 'Joshi', 'Larsson', 'Perez', 'Venkatesh', 'Schneider', 'Kassir',
    'Sokolov', 'Abdi', 'Takahashi', 'Romano', 'Gupta', 'Silva', 'Lindqvist', 'Morales',
    'Zhou', 'Bakshi', 'Castillo', 'Bhandari', 'Aitken', 'van Dijk', 'Haddad', 'Mehta',
    'Horvat', 'Farah', 'Sato', 'Bianchi', 'Kaur', 'Diaz', 'Holm', 'Mendoza',
    'Petrov', 'Sayed', 'Suzuki', 'Russo', 'Verma', 'Gomes', 'Engstrom', 'Reyes',
    'Li', 'Chatterjee', 'Torres', 'Deshmukh', 'MacKenzie', 'de Jong', 'Mansour', 'Kapoor',
    'Watanabe', 'Adeyemi', 'Leclerc', 'Boucher', 'Sweeney', 'Hansen', 'Vasquez', 'Sinclair'
]

# Generate 500 user objects
users_data = []
curr_user_idx = 1

for dept_name, sub_name, count in subdept_plan:
    s_obj = find_subdept(dept_name, sub_name)
    if not s_obj:
        print(f"ERROR: Could not find subdept {dept_name} -> {sub_name}")
        continue
    s_id = s_obj['id']
    d_id = s_obj['department_id']
    s_roles = roles_by_subdept.get(s_id, [])
    if not s_roles:
        print(f"WARNING: No roles for {dept_name} -> {sub_name}")
        continue

    # Sort roles by level descending
    s_roles.sort(key=lambda r: (r.get('remuneration_level') or 99), reverse=True)

    for i in range(count):
        idx = curr_user_idx
        email = f"test{idx}@test.com"
        password = f"test{idx}"

        # If user 1 to 100, use their exact id and name
        if idx <= len(first_100):
            orig = first_100[idx - 1]
            u_id = orig['id']
            first_name = orig['first_name']
            last_name = orig['last_name']
        else:
            # Deterministic UUID
            u_id = f"d1000000-0000-0000-0000-{idx:012d}"
            first_name = first_names[(idx * 7) % len(first_names)]
            last_name = last_names[(idx * 11) % len(last_names)]

        # Determine employment status & role in this subdepartment
        # 1st person in subdept is supervisor/manager (FT)
        # 2nd person (if count >= 8) is assistant supervisor / lead (FT or PT)
        # 3rd person (if count >= 15) is senior tech / lead (PT)
        # Remaining: casual
        if i == 0:
            emp_status = 'Full-Time'
            role = s_roles[0] # highest role (manager/supervisor)
            access_level = 'delta' if dept_name in ['Culinary Services', 'Event Delivery'] and i == 0 and idx <= 20 else 'gamma'
        elif i == 1 and count >= 5:
            emp_status = 'Full-Time' if (idx % 3 == 0) else 'Part-Time'
            role = s_roles[min(1, len(s_roles) - 1)]
            access_level = 'beta'
        elif i == 2 and count >= 10:
            emp_status = 'Part-Time'
            role = s_roles[min(2, len(s_roles) - 1)]
            access_level = 'beta'
        elif i < 6 and count >= 20:
            emp_status = 'Full-Time' if (i % 2 == 0) else 'Casual'
            role = s_roles[min(i, len(s_roles) - 1)]
            access_level = 'alpha'
        else:
            emp_status = 'Casual' if (idx % 5 != 0) else 'Part-Time'
            role = s_roles[-1] # base level role
            access_level = 'alpha'

        # Guardrail on hours
        if emp_status == 'Full-Time':
            hours = 38
        elif emp_status == 'Part-Time':
            hours = 20 + (idx % 12) # 20 to 31 hours
        else:
            hours = 0

        # Terminated status for ~15 users
        is_terminated = idx in [48, 97, 142, 191, 239, 284, 329, 374, 419, 464]
        is_active = not is_terminated
        profile_status = 'terminated' if is_terminated else 'active'
        contract_status = 'Expired' if is_terminated else 'Active'
        term_date = '2026-08-31' if is_terminated else None

        hire_year = 2020 + (idx % 6)
        hire_month = (idx % 12) + 1
        hire_date = f"{hire_year:04d}-{hire_month:02d}-01"

        dob_year = 1965 + ((idx * 7) % 38)
        dob_month = ((idx * 3) % 12) + 1
        dob_day = ((idx * 5) % 27) + 1
        dob = f"{dob_year:04d}-{dob_month:02d}-{dob_day:02d}"

        phone = f"+61 4{(idx * 37) % 90 + 10:02d} {(idx * 19) % 900 + 100:03d} {(idx * 53) % 900 + 100:03d}"
        emg_name = f"{first_names[(idx + 13) % len(first_names)]} {last_name}"
        emg_phone = f"+61 4{(idx * 43) % 90 + 10:02d} {(idx * 23) % 900 + 100:03d} {(idx * 61) % 900 + 100:03d}"
        rest_gap = (idx % 3 == 0)

        # JSON preferences
        shift_pref = ['morning'] if idx % 3 == 0 else (['afternoon', 'night'] if idx % 3 == 1 else ['morning', 'afternoon'])
        uniform = ['S', 'M', 'L', 'XL', '2XL'][idx % 5]
        dietary = ['None', 'None', 'Vegetarian', 'Gluten-Free', 'Halal', 'None', 'Vegan'][idx % 7]
        prefs = {
            'preferred_shifts': shift_pref,
            'max_weekly_hours': hours if hours > 0 else 24,
            'uniform_size': uniform,
            'dietary_requirements': dietary,
            'notification_preferences': {
                'email': True,
                'sms': (idx % 4 != 0),
                'push': True
            }
        }

        # Pay basis rules: Casual CANNOT be salaried
        rem_level = role.get('remuneration_level')
        if emp_status == 'Casual':
            pay_basis = 'eba_level'
            annual_salary = None
            if rem_level is None:
                rem_level = 2
        elif rem_level is None:
            pay_basis = 'salary'
            annual_salary = 95000 + (idx % 40) * 1500
        else:
            pay_basis = 'eba_level'
            annual_salary = None

        users_data.append({
            'idx': idx,
            'id': u_id,
            'first_name': first_name,
            'last_name': last_name,
            'email': email,
            'password': password,
            'emp_code': f"ICC-{1000 + idx}",
            'phone': phone,
            'dob': dob,
            'emg_name': emg_name,
            'emg_phone': emg_phone,
            'emp_status': emp_status,
            'hire_date': hire_date,
            'is_active': is_active,
            'profile_status': profile_status,
            'contract_status': contract_status,
            'term_date': term_date,
            'rest_gap': rest_gap,
            'prefs': prefs,
            'dept_name': dept_name,
            'dept_id': d_id,
            'sub_dept_name': sub_name,
            'sub_dept_id': s_id,
            'role_id': role['id'],
            'role_name': role['name'],
            'rem_level': rem_level,
            'access_level': access_level,
            'hours': hours,
            'pay_basis': pay_basis,
            'annual_salary': annual_salary,
            'position_id': str(uuid.uuid4())
        })
        curr_user_idx += 1

print(f"Generated data for {len(users_data)} users.")

# Count employment statuses
ft_count = sum(1 for u in users_data if u['emp_status'] == 'Full-Time')
pt_count = sum(1 for u in users_data if u['emp_status'] == 'Part-Time')
cas_count = sum(1 for u in users_data if u['emp_status'] == 'Casual')
print(f"Breakdown: FT={ft_count}, PT={pt_count}, Casual={cas_count}")

# Select secondary multi-hire roles for ~35 casual users
multi_hire_subdept = find_subdept('Event Delivery', 'Retail & Beverage')
multi_hire_roles = roles_by_subdept.get(multi_hire_subdept['id'], [])
multi_hire_role = multi_hire_roles[-1] if multi_hire_roles else None

# Skill selection logic based on department
def get_skills_for_user(u):
    d_name = u['dept_name']
    u_skills = []
    
    # Common skills
    if 'Customer Service' in skills_by_name:
        u_skills.append(('Customer Service', 'Competent'))
    
    if d_name == 'Culinary Services':
        for s in ['Food Handling', 'Manual Handling', 'First Aid']:
            if s in skills_by_name:
                u_skills.append((s, 'Competent'))
        if u['idx'] % 2 == 0 and 'Barista Basics' in skills_by_name:
            u_skills.append(('Barista Basics', 'Proficient'))
    elif d_name in ['Event Delivery', 'Customer Services']:
        for s in ['RSA Certificate', 'Bartending', 'Wine Service']:
            if s in skills_by_name:
                u_skills.append((s, 'Competent'))
        if u['idx'] % 3 == 0 and 'VIP Guest Handling' in skills_by_name:
            u_skills.append(('VIP Guest Handling', 'Proficient'))
    elif d_name in ['Events', 'Building Services']:
        for s in ['Manual Handling', 'White Card', 'Heavy Lifting']:
            if s in skills_by_name:
                u_skills.append((s, 'Competent'))
        if u['idx'] % 4 == 0 and 'Forklift Operation' in skills_by_name:
            u_skills.append(('Forklift Operation', 'Competent'))
    elif d_name == 'Audio Visual Services':
        for s in ['Audio Visual Setup', 'Sound Engineering', 'Lighting Operation']:
            if s in skills_by_name:
                u_skills.append((s, 'Competent'))
        if u['idx'] % 3 == 0 and 'Working at Heights' in skills_by_name:
            u_skills.append(('Working at Heights', 'Competent'))
    elif d_name == 'Security & Risk':
        for s in ['Crowd Management', 'First Aid Lv2', 'Fire Warden', 'Emergency Evacuation']:
            if s in skills_by_name:
                u_skills.append((s, 'Competent'))
        if u['idx'] % 2 == 0 and 'ES-GOLD' in skills_by_name:
            u_skills.append(('ES-GOLD', 'Competent'))
    
    # Leadership for supervisors
    if u['access_level'] in ['beta', 'gamma', 'delta']:
        if 'Team Leadership' in skills_by_name:
            u_skills.append(('Team Leadership', 'Proficient'))
        if 'Shift Supervision' in skills_by_name:
            u_skills.append(('Shift Supervision', 'Expert'))
            
    return u_skills

# License selection logic
def get_licenses_for_user(u):
    d_name = u['dept_name']
    u_lics = []
    
    if d_name in ['Event Delivery', 'Culinary Services']:
        if 'RSA' in licenses_by_name:
            u_lics.append(('RSA', 'Standard', 'Verified'))
        if 'Food Safety Certificate' in licenses_by_name:
            u_lics.append(('Food Safety Certificate', 'Standard', 'Verified'))
    elif d_name == 'Security & Risk':
        if 'First Aid Certificate' in licenses_by_name:
            u_lics.append(('First Aid Certificate', 'Standard', 'Verified'))
        if 'Crowd Controller License' in licenses_by_name:
            u_lics.append(('Crowd Controller License', 'Standard', 'Verified'))
    elif d_name in ['Events', 'Building Services']:
        if 'Driver License - C' in licenses_by_name:
            u_lics.append(('Driver License - C', 'Standard', 'Verified'))
    
    # 15 users with Student Visa (WorkRights)
    if u['idx'] in [15, 45, 75, 105, 135, 165, 195, 225, 255, 285, 315, 345, 375, 405, 435]:
        if 'Working With Children Check' in licenses_by_name:
            u_lics.append(('Working With Children Check', 'WorkRights', 'Verified', True)) # restricted limit = True

    return u_lics

# Availability rules patterns for Casual / PT
avail_patterns = [
    # 1: Open 7-days
    ('00:00:00', '23:59:59', [1, 2, 3, 4, 5, 6, 7]),
    # 2: Weekday standard
    ('07:00:00', '19:00:00', [1, 2, 3, 4, 5]),
    # 3: Weekend special
    ('08:00:00', '23:59:59', [6, 7]),
    # 4: Evening / Night shifts
    ('16:00:00', '23:59:59', [3, 4, 5, 6]),
    # 5: Morning shifts
    ('06:00:00', '15:00:00', [1, 2, 3, 4, 5]),
]

# Generate SQL Batches (50 users per batch = 10 batches)
os.makedirs('scratch/batches', exist_ok=True)
batch_size = 50
num_batches = (len(users_data) + batch_size - 1) // batch_size

for b in range(num_batches):
    batch_users = users_data[b * batch_size : (b + 1) * batch_size]
    lines = []
    lines.append(f"-- SEED BATCH {b + 1} (Users {b * batch_size + 1} to {min((b + 1) * batch_size, len(users_data))})")
    lines.append("DO $$")
    lines.append("DECLARE")
    lines.append("    v_org_id UUID := '00000000-0000-0000-0000-000000000001';")
    lines.append("BEGIN")

    for u in batch_users:
        u_id = u['id']
        email = u['email']
        pwd = u['password']
        fn = u['first_name'].replace("'", "''")
        ln = u['last_name'].replace("'", "''")
        prefs_json = json.dumps(u['prefs']).replace("'", "''")
        
        raw_app_meta = '{"provider":"email","providers":["email"]}'
        emg_clean = u['emg_name'].replace("'", "''")

        # 1. Auth user
        lines.append(f"    -- User {u['idx']}: {email}")
        lines.append(f"    INSERT INTO auth.users (")
        lines.append(f"        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,")
        lines.append(f"        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,")
        lines.append(f"        confirmation_token, recovery_token, email_change_token_new, email_change")
        lines.append(f"    ) VALUES (")
        lines.append(f"        '00000000-0000-0000-0000-000000000000', '{u_id}', 'authenticated', 'authenticated',")
        lines.append(f"        '{email}', crypt('{pwd}', gen_salt('bf')), now(),")
        lines.append(f"        '{raw_app_meta}',")
        lines.append(f"        jsonb_build_object('first_name', '{fn}', 'last_name', '{ln}'),")
        lines.append(f"        now(), now(), '', '', '', ''")
        lines.append(f"    ) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;")

        # 2. Update profile
        term_val = f"'{u['term_date']}'::date" if u['term_date'] else "NULL"
        lines.append(f"    UPDATE public.profiles SET")
        lines.append(f"        first_name = '{fn}',")
        lines.append(f"        last_name = '{ln}',")
        lines.append(f"        employee_code = '{u['emp_code']}',")
        lines.append(f"        phone = '{u['phone']}',")
        lines.append(f"        avatar_url = 'https://api.dicebear.com/7.x/avataaars/svg?seed={email}',")
        lines.append(f"        date_of_birth = '{u['dob']}'::date,")
        lines.append(f"        emergency_contact_name = '{emg_clean}',")

        lines.append(f"        emergency_contact_phone = '{u['emg_phone']}',")
        lines.append(f"        employment_type = '{u['emp_status']}',")
        lines.append(f"        hire_date = '{u['hire_date']}'::date,")
        lines.append(f"        continuous_service_start = '{u['hire_date']}'::date,")
        lines.append(f"        is_active = {str(u['is_active']).lower()},")
        lines.append(f"        status = '{u['profile_status']}',")
        lines.append(f"        termination_date = {term_val},")
        lines.append(f"        rest_gap_agreement_8h = {str(u['rest_gap']).lower()},")
        lines.append(f"        preferences = '{prefs_json}'::jsonb")
        lines.append(f"    WHERE id = '{u_id}';")

        # 3. Clean existing contracts, availability, skills, licenses, metrics
        lines.append(f"    DELETE FROM hr.user_contracts WHERE user_id = '{u_id}';")
        lines.append(f"    DELETE FROM public.availability_rules WHERE profile_id = '{u_id}';")
        lines.append(f"    DELETE FROM public.employee_skills WHERE employee_id = '{u_id}';")
        lines.append(f"    DELETE FROM public.employee_licenses WHERE employee_id = '{u_id}';")
        lines.append(f"    DELETE FROM public.employee_performance_metrics WHERE employee_id = '{u_id}';")

        # 4. Primary Contract
        if u['pay_basis'] == 'salary':
            rem_str = "NULL"
            sal_str = f"'{u['annual_salary']:.2f}'"
            excl_str = "'above_threshold'"
        else:
            rem_str = str(u['rem_level'] if u['rem_level'] is not None else 2)
            sal_str = "NULL"
            excl_str = "NULL"
        lines.append(f"    INSERT INTO hr.user_contracts (")
        lines.append(f"        id, user_id, organization_id, department_id, sub_department_id, role_id,")
        lines.append(f"        status, start_date, end_date, access_level, employment_status, contracted_weekly_hours,")
        lines.append(f"        remuneration_level, position_id, ordinary_hours_cycle_weeks, ordinary_hours_cycle_anchor,")
        lines.append(f"        pay_basis, annual_salary, eba_exclusion_reason, engagement_kind")
        lines.append(f"    ) VALUES (")
        lines.append(f"        gen_random_uuid(), '{u_id}', v_org_id, '{u['dept_id']}', '{u['sub_dept_id']}', '{u['role_id']}',")
        lines.append(f"        '{u['contract_status']}', '{u['hire_date']}'::date, {term_val}, '{u['access_level']}', '{u['emp_status']}', {u['hours']},")
        lines.append(f"        {rem_str}, '{u['position_id']}', 4, '2024-01-01'::date,")
        lines.append(f"        '{u['pay_basis']}', {sal_str}, {excl_str}, 'primary'")
        lines.append(f"    );")

        # 5. Optional Multi-hire contract for ~35 casual users (ensure different subdepartment)
        if u['emp_status'] == 'Casual' and u['idx'] % 14 == 0 and multi_hire_role and u['sub_dept_id'] != multi_hire_subdept['id']:
            sec_pos = str(uuid.uuid4())
            lines.append(f"    INSERT INTO hr.user_contracts (")
            lines.append(f"        id, user_id, organization_id, department_id, sub_department_id, role_id,")
            lines.append(f"        status, start_date, end_date, access_level, employment_status, contracted_weekly_hours,")
            lines.append(f"        remuneration_level, position_id, ordinary_hours_cycle_weeks, ordinary_hours_cycle_anchor,")
            lines.append(f"        pay_basis, engagement_kind, multi_hire_request_ref")
            lines.append(f"    ) VALUES (")
            lines.append(f"        gen_random_uuid(), '{u_id}', v_org_id, '{multi_hire_subdept['department_id']}', '{multi_hire_subdept['id']}', '{multi_hire_role['id']}',")
            lines.append(f"        'Active', '{u['hire_date']}'::date, NULL, 'alpha', 'Casual', 0,")
            lines.append(f"        2, '{sec_pos}', 4, '2024-01-01'::date,")
            lines.append(f"        'eba_level', 'multi_hire', 'Approved'")
            lines.append(f"    );")


        # 6. Availability rule (Only for Casual & Part-Time!)
        if u['emp_status'] in ['Casual', 'Part-Time'] and u['is_active']:
            pat = avail_patterns[u['idx'] % len(avail_patterns)]
            days_arr = f"ARRAY{pat[2]}::SMALLINT[]"
            lines.append(f"    INSERT INTO public.availability_rules (")
            lines.append(f"        profile_id, sub_department_id, start_date, start_time, end_time,")
            lines.append(f"        repeat_type, repeat_days, repeat_end_date")
            lines.append(f"    ) VALUES (")
            lines.append(f"        '{u_id}', '{u['sub_dept_id']}', '2026-09-01'::date, '{pat[0]}'::time, '{pat[1]}'::time,")
            lines.append(f"        'weekly', {days_arr}, '2026-12-31'::date")
            lines.append(f"    );")

        # 7. Skills
        u_skills = get_skills_for_user(u)
        for s_name, prof in u_skills:
            s_id = skills_by_name[s_name]
            lines.append(f"    INSERT INTO public.employee_skills (employee_id, skill_id, status, proficiency_level, issue_date)")
            lines.append(f"    VALUES ('{u_id}', '{s_id}', 'Active', '{prof}', '{u['hire_date']}'::date);")

        # 8. Licenses
        u_lics = get_licenses_for_user(u)
        for l_item in u_lics:
            l_name = l_item[0]
            l_type = l_item[1]
            l_stat = l_item[2]
            l_rest = l_item[3] if len(l_item) > 3 else False
            l_id = licenses_by_name[l_name]
            lines.append(f"    INSERT INTO public.employee_licenses (")
            lines.append(f"        id, employee_id, license_id, issue_date, expiration_date, status, verification_status, license_type, has_restricted_work_limit")
            lines.append(f"    ) VALUES (")
            lines.append(f"        gen_random_uuid(), '{u_id}', '{l_id}', '{u['hire_date']}'::date, ('{u['hire_date']}'::date + interval '4 years')::date, 'Active', '{l_stat}', '{l_type}', {str(l_rest).lower()}")
            lines.append(f"    );")

        # 9. First aid appointment (~25 users)
        if any(s[0] in ['First Aid', 'First Aid Lv2'] for s in u_skills) and u['idx'] % 15 == 0:
            lines.append(f"    IF NOT EXISTS (SELECT 1 FROM public.first_aid_appointments WHERE employee_id = '{u_id}') THEN")
            lines.append(f"        INSERT INTO public.first_aid_appointments (id, organization_id, employee_id, effective_from)")
            lines.append(f"        VALUES (gen_random_uuid(), v_org_id, '{u_id}', '2026-01-01'::date);")
            lines.append(f"    END IF;")


        # 10. Shift-history figures (feed the performance metrics below)
        shifts_ass = 15 + (u['idx'] * 13) % 75
        cancels = (u['idx'] % 4 == 0) and 1 or 0
        lates = (u['idx'] % 6 == 0) and 1 or 0
        noshow = 1 if (u['idx'] % 49 == 0) else 0
        completed = max(0, shifts_ass - cancels - noshow)
        ontime = round(100.0 * (completed - lates) / max(1, completed), 1)

        # 11. Performance metrics
        offered = shifts_ass + 5
        accepted = shifts_ass
        rel_score = round(0.85 + (u['idx'] % 14) * 0.01, 2)
        lines.append(f"    INSERT INTO public.employee_performance_metrics (")
        lines.append(f"        id, employee_id, period_start, period_end, quarter_year,")
        lines.append(f"        shifts_offered, shifts_accepted, shifts_rejected, shifts_assigned, shifts_worked, shifts_swapped,")
        lines.append(f"        acceptance_rate, punctuality_rate, attendance_rate, reliability_score,")
        lines.append(f"        early_clock_ins, late_clock_outs, early_clock_in_rate, late_clock_out_rate,")
        lines.append(f"        on_time_in, on_time_out, on_time_in_rate, on_time_out_rate,")
        lines.append(f"        auto_clock_outs, auto_clock_out_rate")
        lines.append(f"    ) VALUES (")
        lines.append(f"        gen_random_uuid(), '{u_id}', '2026-07-01'::date, '2026-09-30'::date, '2026-Q3',")
        lines.append(f"        {offered}, {accepted}, {offered - accepted}, {shifts_ass}, {completed}, 1,")
        lines.append(f"        {round(accepted/offered, 2)}, {round(ontime/100.0, 2)}, 0.98, {rel_score},")
        lines.append(f"        2, 1, 0.05, 0.03,")
        lines.append(f"        {max(0, completed - lates)}, {completed}, 0.96, 0.98,")
        lines.append(f"        0, 0.0")
        lines.append(f"    );")
        lines.append("")

    lines.append("END $$;")
    batch_file = f"scratch/batches/seed_batch_{b + 1}.sql"
    with open(batch_file, "w") as f_out:
        f_out.write("\n".join(lines))
    print(f"Wrote {batch_file} ({len(batch_users)} users)")

print("All 10 batches generated successfully!")
