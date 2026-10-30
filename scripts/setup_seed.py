import json
import random
import uuid

# Set seed for reproducible generation
random.seed(42)

with open('scratch/seed_metadata.json') as f:
    meta = json.load(f)

with open('scratch/seed_roles.json') as f:
    roles = json.load(f)

with open('scratch/first_100_users.json') as f:
    first_100 = json.load(f)

org_id = meta['org_id']
departments = meta['departments']
sub_departments = meta['sub_departments']
skills = meta['skills']
licenses = meta['licenses']

subdept_map = {s['id']: s for s in sub_departments}
roles_by_subdept = {}
for r in roles:
    s_id = r.get('subdepartment_id')
    if s_id:
        roles_by_subdept.setdefault(s_id, []).append(r)

# Map departments by name
dept_by_name = {d['name']: d for d in departments}

# Target distribution across departments (total = 500)
dept_allocations = [
    ('Culinary Services', 90),
    ('Event Delivery', 100),
    ('Events', 80),
    ('Audio Visual Services', 60),
    ('Customer Services', 50),
    ('Building Services', 45),
    ('Security & Risk', 35),
    ('Live Entertainment', 15),
    ('ICT Services', 10),
    ('People & Culture', 5),
    ('Finance & Administration', 5),
    ('Executive Office', 5),
]

# Diverse first and last names for users 101 to 500
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
    'Hassan', 'Billie', 'Caleb', 'Abigail'
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
    'Li', 'Chatterjee', 'Torres', 'Deshmukh', 'MacKenzie', 'de Jong', 'Mansour', 'Kapoor'
]

def make_phone(seed_val):
    num = (seed_val * 7391 + 1234) % 900000 + 100000
    return f"+61 4{num // 10000:02d} {num % 10000:04d} 00"

print("Setup completed. Preparing user allocations...")
