# Seeded Test Users and Mock Data (500 Users)

This document contains the comprehensive catalog of 500 seeded users with diverse mock data across all 12 operational departments at ICC Sydney.

## Credential Pattern
For all test users, credentials follow the standard development pattern:
- **Email**: `test{N}@test.com` (from `test1@test.com` to `test500@test.com`)
- **Password**: `test{N}`
- **Authentication**: All accounts have confirmed emails and bcrypt password hashes in `auth.users`, enabling direct sign-in.

---

## Distribution Overview

### Headcount by Department
| Department | Count | Proportion |
| :--- | :--- | :--- |
| Event Delivery | 100 | 20.0% |
| Culinary Services | 90 | 18.0% |
| Events | 80 | 16.0% |
| Audio Visual Services | 60 | 12.0% |
| Customer Services | 50 | 10.0% |
| Building Services | 45 | 9.0% |
| Security & Risk | 35 | 7.0% |
| Live Entertainment | 15 | 3.0% |
| ICT Services | 10 | 2.0% |
| People & Culture | 5 | 1.0% |
| Finance & Administration | 5 | 1.0% |
| Executive Office | 5 | 1.0% |

### Headcount by Employment Type
| Employment Type | Count | Standard Hours | Pay Basis |
| :--- | :--- | :--- | :--- |
| Full-Time | 51 | 38h / week | Salaried & EBA Level 3-7 |
| Part-Time | 127 | 20-31h / week | EBA Level 2-4 |
| Casual | 322 | 0h contracted (hourly) | EBA Level 1-4 |

### Access Levels
| Access Level | Scope | Headcount | Target Roles |
| :--- | :--- | :--- | :--- |
| `alpha` | Base Staff | 421 | Team Members, Attendants, Crew, Kitchen Hands, Ushers |
| `beta` | Sub-department Lead | 47 | Team Leaders, Senior Technicians, Lead Ushers |
| `gamma` | Sub-department Manager | 31 | Supervisors, Assistant Managers, Sous Chefs |
| `delta` | Department Manager | 1 | Department Managers, Executive Chefs, Floor Managers |

---

## Mock Data Dimensions Included
Each seeded user profile includes complete relational and compliance data:
- **Personal Details**: Full name, employee code (`ICC-1001` to `ICC-1500`), date of birth (ages 19-61), Australian phone numbers, emergency contact details.
- **Compliance & EBA Terms**: Rest gap agreement (8h vs 10h), continuous service dates, employment statuses, contracted weekly hours, 4-week cycle anchors.
- **Skills & Proficiencies**: 2 to 5 verified skills per user (e.g. RSA, First Aid Lv2, Food Handling, Sound Engineering, Crowd Management, ES-GOLD, Barista Basics) with proficiency levels (`Novice`, `Competent`, `Proficient`, `Expert`).
- **Licenses & Work Rights**: Mandatory and professional licenses (`RSA`, `Food Safety Certificate`, `Working With Children Check`, `Driver License - C`, `Forklift License`) with verified statuses and student visa work limits (`license_type = 'WorkRights'`).
- **First Aid Appointments**: Qualified first aid officers appointed under ICC Sydney organization.
- **Availability Rules**: Weekly recurring availability patterns with day-by-day availability slots automatically generated for Casual and Part-Time staff.
- **Reliability & Performance Metrics**: Historical attendance, on-time percentage (88%-100%), cancellation rates, punctuality scores, clock-in metrics.
- **Preferences**: JSONB shift preferences (morning/afternoon/night), uniform sizes, and notification preferences.

---

## Complete 500 User Catalog

| # | Name | Email | Password | Code | Department | Subdepartment | Role | Type | Access | User ID |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | James Smith | `test1@test.com` | `test1` | `ICC-1001` | Culinary Services | Events & Catering Kitchen | Junior Sous Chef | Full-Time | `delta` | `3a606351-e93f-44b6-b700-078f108ef80a` |
| 2 | Mary Smith | `test2@test.com` | `test2` | `ICC-1002` | Culinary Services | Events & Catering Kitchen | Sous Chef | Part-Time | `beta` | `905b5f3d-9147-4a85-b05c-dd558140c040` |
| 3 | John Smith | `test3@test.com` | `test3` | `ICC-1003` | Culinary Services | Events & Catering Kitchen | Senior Sous Chef | Part-Time | `beta` | `0e5cf5bb-e09f-4915-9478-688a86dc3473` |
| 4 | Patricia Smith | `test4@test.com` | `test4` | `ICC-1004` | Culinary Services | Events & Catering Kitchen | Chef de Cuisine | Casual | `alpha` | `9be8f484-bcac-48a7-95aa-36478a725096` |
| 5 | Robert Smith | `test5@test.com` | `test5` | `ICC-1005` | Culinary Services | Events & Catering Kitchen | Executive Sous Chef | Full-Time | `alpha` | `d1572239-1d90-4279-bc7b-3e92ed4ba8b8` |
| 6 | Jennifer Smith | `test6@test.com` | `test6` | `ICC-1006` | Culinary Services | Events & Catering Kitchen | Chef de Partie | Casual | `alpha` | `b00f8c79-5461-4401-8613-f3e1d028f9c5` |
| 7 | Michael Smith | `test7@test.com` | `test7` | `ICC-1007` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `a912894a-b1c4-4478-ae4d-72815dda70f2` |
| 8 | Linda Smith | `test8@test.com` | `test8` | `ICC-1008` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `e2944b03-dcd9-4a30-93e5-d04f580a9e10` |
| 9 | William Smith | `test9@test.com` | `test9` | `ICC-1009` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `ca851d92-b69b-43c5-b5e8-aa9e1c177a28` |
| 10 | Elizabeth Smith | `test10@test.com` | `test10` | `ICC-1010` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Part-Time | `alpha` | `2753de74-f623-4aa1-9a96-b5b975a83927` |
| 11 | David Smith | `test11@test.com` | `test11` | `ICC-1011` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `138b3265-0423-42b2-acbd-f9802c41f791` |
| 12 | Barbara Smith | `test12@test.com` | `test12` | `ICC-1012` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `48163676-1d17-41c4-abd3-ba71413464bd` |
| 13 | Richard Smith | `test13@test.com` | `test13` | `ICC-1013` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `1e8d161e-e3b1-4ac4-90ea-8f493311363e` |
| 14 | Susan Smith | `test14@test.com` | `test14` | `ICC-1014` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `58d8098b-5b5a-4548-aa9e-872cd7021cb4` |
| 15 | Joseph Smith | `test15@test.com` | `test15` | `ICC-1015` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Part-Time | `alpha` | `24d054d7-cf5f-4da0-be8b-68486a54d93e` |
| 16 | Jessica Smith | `test16@test.com` | `test16` | `ICC-1016` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `04f22f9d-c369-4ad2-ab6b-7f8cb6076895` |
| 17 | Thomas Smith | `test17@test.com` | `test17` | `ICC-1017` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `772ce274-991c-456a-b826-7a5a3f351e37` |
| 18 | Sarah Smith | `test18@test.com` | `test18` | `ICC-1018` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `0ed35e33-5091-4c3d-b0c9-83200703c8a9` |
| 19 | Charles Smith | `test19@test.com` | `test19` | `ICC-1019` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `cb630f33-3563-44be-ba5b-43e5e2e49580` |
| 20 | Karen Smith | `test20@test.com` | `test20` | `ICC-1020` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Part-Time | `alpha` | `bfe97b88-66e5-415d-a16a-ed045a257f63` |
| 21 | James Johnson | `test21@test.com` | `test21` | `ICC-1021` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `a664e166-5393-4b6e-8883-2d9659d4f5d1` |
| 22 | Mary Johnson | `test22@test.com` | `test22` | `ICC-1022` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `8ddfb030-1337-4120-9602-80d267f3e0a8` |
| 23 | John Johnson | `test23@test.com` | `test23` | `ICC-1023` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `8a9e6fcc-b602-4676-a199-2d03ca41adb8` |
| 24 | Patricia Johnson | `test24@test.com` | `test24` | `ICC-1024` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `51d05ae1-d379-4102-9a34-c3f0435d8d0f` |
| 25 | Robert Johnson | `test25@test.com` | `test25` | `ICC-1025` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Part-Time | `alpha` | `e15efde6-76d8-4103-9ed0-81b08053a023` |
| 26 | Jennifer Johnson | `test26@test.com` | `test26` | `ICC-1026` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `c22e6404-b0ac-43be-889b-e3e964bb6518` |
| 27 | Michael Johnson | `test27@test.com` | `test27` | `ICC-1027` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `c09defd6-d1e0-4d42-b2a7-cfe06f4d1434` |
| 28 | Linda Johnson | `test28@test.com` | `test28` | `ICC-1028` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `7b59b2ac-0d58-49ea-90b8-e43c66e77d18` |
| 29 | William Johnson | `test29@test.com` | `test29` | `ICC-1029` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `9331117b-2397-4fea-8c41-2a1b8d6c8420` |
| 30 | Elizabeth Johnson | `test30@test.com` | `test30` | `ICC-1030` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Part-Time | `alpha` | `50eeeebd-fb62-4aa0-8894-36d74b1286d2` |
| 31 | David Johnson | `test31@test.com` | `test31` | `ICC-1031` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `5a02ef88-7f35-4df0-9197-b2844d1b95e5` |
| 32 | Barbara Johnson | `test32@test.com` | `test32` | `ICC-1032` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `fb8c33ab-4186-4194-ab5f-56af57b03267` |
| 33 | Richard Johnson | `test33@test.com` | `test33` | `ICC-1033` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `788a794c-d033-405d-a8f0-10defabdcc33` |
| 34 | Susan Johnson | `test34@test.com` | `test34` | `ICC-1034` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Casual | `alpha` | `8ed3bce7-74b5-4a76-8556-401a15f75c73` |
| 35 | Joseph Johnson | `test35@test.com` | `test35` | `ICC-1035` | Culinary Services | Events & Catering Kitchen | Apprentice Chef | Part-Time | `alpha` | `166933ef-e26c-4ef7-ac57-ff33d0106052` |
| 36 | Jessica Johnson | `test36@test.com` | `test36` | `ICC-1036` | Culinary Services | Kitchen Logistics & Stewarding | Kitchen Logistics Team Leader | Full-Time | `gamma` | `396f4803-c0ee-4253-ae4c-016185e2f826` |
| 37 | Thomas Johnson | `test37@test.com` | `test37` | `ICC-1037` | Culinary Services | Kitchen Logistics & Stewarding | Senior Steward Supervisor | Part-Time | `beta` | `92673ad6-f016-4411-91ce-2c61f5c8989d` |
| 38 | Sarah Johnson | `test38@test.com` | `test38` | `ICC-1038` | Culinary Services | Kitchen Logistics & Stewarding | Senior Kitchen Logistics Supervisor | Part-Time | `beta` | `05b542be-ae2e-428f-b8fa-2c86b7ba04be` |
| 39 | Charles Johnson | `test39@test.com` | `test39` | `ICC-1039` | Culinary Services | Kitchen Logistics & Stewarding | Chief Steward | Casual | `alpha` | `3b948d50-baf3-462b-88b8-83659eb4649a` |
| 40 | Karen Johnson | `test40@test.com` | `test40` | `ICC-1040` | Culinary Services | Kitchen Logistics & Stewarding | Kitchen Logistics Manager | Full-Time | `alpha` | `08e7c9e8-e3b9-44d8-a540-1d6d82a22f21` |
| 41 | James Williams | `test41@test.com` | `test41` | `ICC-1041` | Culinary Services | Kitchen Logistics & Stewarding | Steward Supervisor | Casual | `alpha` | `60db4860-7bbf-49fc-b482-968a58f7ec1b` |
| 42 | Mary Williams | `test42@test.com` | `test42` | `ICC-1042` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Casual | `alpha` | `d146f33b-369e-4fff-997e-d30d6b2d2ffb` |
| 43 | John Williams | `test43@test.com` | `test43` | `ICC-1043` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Casual | `alpha` | `607f42e5-d83b-4e05-9482-678d1f6ca8bf` |
| 44 | Patricia Williams | `test44@test.com` | `test44` | `ICC-1044` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Casual | `alpha` | `e17260eb-a910-4a3b-90a0-750e593a1473` |
| 45 | Robert Williams | `test45@test.com` | `test45` | `ICC-1045` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Part-Time | `alpha` | `42ac41e1-9144-4cee-9156-7bd5364a82b3` |
| 46 | Jennifer Williams | `test46@test.com` | `test46` | `ICC-1046` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Casual | `alpha` | `c1adf1c0-f2e2-4d7f-b0ac-a7a04e15cd9b` |
| 47 | Michael Williams | `test47@test.com` | `test47` | `ICC-1047` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Casual | `alpha` | `6cd4ee29-bf52-4eb1-b639-17da61274a16` |
| 48 | Linda Williams | `test48@test.com` | `test48` | `ICC-1048` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Casual | `alpha` | `fc4768e7-6570-4712-8d37-93b3716a2f90` |
| 49 | William Williams | `test49@test.com` | `test49` | `ICC-1049` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Casual | `alpha` | `7045980b-31c1-4b83-97a0-9d150f40a8a5` |
| 50 | Elizabeth Williams | `test50@test.com` | `test50` | `ICC-1050` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Part-Time | `alpha` | `4a09ed83-95c4-41dc-9dd8-db126824ae3b` |
| 51 | David Williams | `test51@test.com` | `test51` | `ICC-1051` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Casual | `alpha` | `ce4b1bc8-d97d-4d03-966b-16d5f748e134` |
| 52 | Barbara Williams | `test52@test.com` | `test52` | `ICC-1052` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Casual | `alpha` | `647f51a1-448d-423e-bd03-c1218c440092` |
| 53 | Richard Williams | `test53@test.com` | `test53` | `ICC-1053` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Casual | `alpha` | `0bbe6419-c162-49be-a6c0-ee480d062c6f` |
| 54 | Susan Williams | `test54@test.com` | `test54` | `ICC-1054` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Casual | `alpha` | `bb6f976a-03e5-47cd-82b8-5f692291dd0e` |
| 55 | Joseph Williams | `test55@test.com` | `test55` | `ICC-1055` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Part-Time | `alpha` | `df2e6496-408e-4eef-ab5b-0fee214ccade` |
| 56 | Jessica Williams | `test56@test.com` | `test56` | `ICC-1056` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Casual | `alpha` | `ee81d62c-1b8d-46b7-8d8f-9426ca6aae84` |
| 57 | Thomas Williams | `test57@test.com` | `test57` | `ICC-1057` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Casual | `alpha` | `1beafcc2-ca18-4181-b7b1-98c1bfb921b0` |
| 58 | Sarah Williams | `test58@test.com` | `test58` | `ICC-1058` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Casual | `alpha` | `ffa63dde-5de5-454f-b63b-37df305f6437` |
| 59 | Charles Williams | `test59@test.com` | `test59` | `ICC-1059` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Casual | `alpha` | `97d00278-2879-4bad-a854-865bebb73bba` |
| 60 | Karen Williams | `test60@test.com` | `test60` | `ICC-1060` | Culinary Services | Kitchen Logistics & Stewarding | Steward | Part-Time | `alpha` | `e9b9283c-3a46-46ca-9045-d6369f3963a9` |
| 61 | James Brown | `test61@test.com` | `test61` | `ICC-1061` | Culinary Services | Pastry | Junior Sous Chef | Full-Time | `gamma` | `85e7b549-9b83-4ab3-8840-2e949aea79b4` |
| 62 | Mary Brown | `test62@test.com` | `test62` | `ICC-1062` | Culinary Services | Pastry | Sous Chef | Part-Time | `beta` | `76320b76-0fba-4cee-8387-f2faeda06a91` |
| 63 | John Brown | `test63@test.com` | `test63` | `ICC-1063` | Culinary Services | Pastry | Senior Sous Chef | Part-Time | `beta` | `d135c526-1d3e-4bb9-9fce-33432eb46f2f` |
| 64 | Patricia Brown | `test64@test.com` | `test64` | `ICC-1064` | Culinary Services | Pastry | Apprentice Cook | Casual | `alpha` | `6b44d523-4cbf-44d6-bf38-0ed139471cdc` |
| 65 | Robert Brown | `test65@test.com` | `test65` | `ICC-1065` | Culinary Services | Pastry | Apprentice Cook | Part-Time | `alpha` | `4cfdcf0f-20c3-4ec2-bc3c-d3f2c509a4b7` |
| 66 | Jennifer Brown | `test66@test.com` | `test66` | `ICC-1066` | Culinary Services | Pastry | Apprentice Cook | Casual | `alpha` | `18e241a5-e097-4874-80a6-6d7457939944` |
| 67 | Michael Brown | `test67@test.com` | `test67` | `ICC-1067` | Culinary Services | Pastry | Apprentice Cook | Casual | `alpha` | `f3ff1ac0-e2bd-41fb-9e2f-22527e118da3` |
| 68 | Linda Brown | `test68@test.com` | `test68` | `ICC-1068` | Culinary Services | Pastry | Apprentice Cook | Casual | `alpha` | `def9935c-4f7e-4f65-ba51-4adc08a5466a` |
| 69 | William Brown | `test69@test.com` | `test69` | `ICC-1069` | Culinary Services | Pastry | Apprentice Cook | Casual | `alpha` | `8bfd0a23-0188-4666-94f0-bb78c736d817` |
| 70 | Elizabeth Brown | `test70@test.com` | `test70` | `ICC-1070` | Culinary Services | Pastry | Apprentice Cook | Part-Time | `alpha` | `6e8d5cc8-a9d7-40af-a59e-7be40438712f` |
| 71 | David Brown | `test71@test.com` | `test71` | `ICC-1071` | Culinary Services | Pastry | Apprentice Cook | Casual | `alpha` | `812c82d6-cc62-4f85-978a-bae8f0aa2798` |
| 72 | Barbara Brown | `test72@test.com` | `test72` | `ICC-1072` | Culinary Services | Pastry | Apprentice Cook | Casual | `alpha` | `a3d57148-70a3-4d97-95ab-7b470d62445d` |
| 73 | Richard Brown | `test73@test.com` | `test73` | `ICC-1073` | Culinary Services | Pastry | Apprentice Cook | Casual | `alpha` | `6559ce4b-ccb2-4916-9dd1-5a1ced0fd789` |
| 74 | Susan Brown | `test74@test.com` | `test74` | `ICC-1074` | Culinary Services | Pastry | Apprentice Cook | Casual | `alpha` | `3e5fdbf1-7609-43ce-959e-01754dd66526` |
| 75 | Joseph Brown | `test75@test.com` | `test75` | `ICC-1075` | Culinary Services | Pastry | Apprentice Cook | Part-Time | `alpha` | `40d50495-bd99-494a-bea6-c1a40265ad96` |
| 76 | Jessica Brown | `test76@test.com` | `test76` | `ICC-1076` | Culinary Services | Production Kitchen | Junior Sous Chef | Full-Time | `gamma` | `deb9e039-2825-4f5e-95e4-b5199ed89713` |
| 77 | Thomas Brown | `test77@test.com` | `test77` | `ICC-1077` | Culinary Services | Production Kitchen | Sous Chef – Sauce | Part-Time | `beta` | `4bb5e536-3014-4f86-9677-7bacdc8ad2c8` |
| 78 | Sarah Brown | `test78@test.com` | `test78` | `ICC-1078` | Culinary Services | Production Kitchen | Sous Chef – Larder | Part-Time | `beta` | `61df8b78-48bb-4ae5-b1a7-f1cc938c223a` |
| 79 | Charles Brown | `test79@test.com` | `test79` | `ICC-1079` | Culinary Services | Production Kitchen | Chef de Partie | Casual | `alpha` | `3d5d2ea4-ec08-43ea-acf3-60a0efb74a16` |
| 80 | Karen Brown | `test80@test.com` | `test80` | `ICC-1080` | Culinary Services | Production Kitchen | Chef de Partie | Part-Time | `alpha` | `d9f335ce-21da-4a5f-99cc-ece290e6f7d2` |
| 81 | James Jones | `test81@test.com` | `test81` | `ICC-1081` | Culinary Services | Production Kitchen | Chef de Partie | Casual | `alpha` | `a476c5b0-3388-4e27-baff-b8f79d7f2098` |
| 82 | Mary Jones | `test82@test.com` | `test82` | `ICC-1082` | Culinary Services | Production Kitchen | Chef de Partie | Casual | `alpha` | `874f3526-c4f8-41ce-bb34-f28141e3d8d7` |
| 83 | John Jones | `test83@test.com` | `test83` | `ICC-1083` | Culinary Services | Production Kitchen | Chef de Partie | Casual | `alpha` | `b8151f2e-d718-41c7-b90d-05ae41502c2e` |
| 84 | Patricia Jones | `test84@test.com` | `test84` | `ICC-1084` | Culinary Services | Production Kitchen | Chef de Partie | Casual | `alpha` | `4a900048-a7dc-44bc-8b37-61635d26df2c` |
| 85 | Robert Jones | `test85@test.com` | `test85` | `ICC-1085` | Culinary Services | Production Kitchen | Chef de Partie | Part-Time | `alpha` | `4072d14e-b916-4872-aa9c-90a5b9ad1f23` |
| 86 | Jennifer Jones | `test86@test.com` | `test86` | `ICC-1086` | Culinary Services | Retail Outlets Kitchen | Sous Chef | Full-Time | `gamma` | `4f399490-019e-40c0-b1db-d0d5b7ccf6e2` |
| 87 | Michael Jones | `test87@test.com` | `test87` | `ICC-1087` | Culinary Services | Retail Outlets Kitchen | Executive Sous Chef | Full-Time | `beta` | `8482f71b-d5bf-48c1-bae4-83d6060e6814` |
| 88 | Linda Jones | `test88@test.com` | `test88` | `ICC-1088` | Culinary Services | Retail Outlets Kitchen | Executive Sous Chef | Casual | `alpha` | `6d3237a8-2d70-4cb7-88db-735310d7840f` |
| 89 | William Jones | `test89@test.com` | `test89` | `ICC-1089` | Culinary Services | Retail Outlets Kitchen | Executive Sous Chef | Casual | `alpha` | `0e487049-a213-44cb-ad14-56cdae6de1a6` |
| 90 | Elizabeth Jones | `test90@test.com` | `test90` | `ICC-1090` | Culinary Services | Retail Outlets Kitchen | Executive Sous Chef | Part-Time | `alpha` | `d4c7f01e-524b-4f61-9acc-f4977173e196` |
| 91 | David Jones | `test91@test.com` | `test91` | `ICC-1091` | Event Delivery | Event Food & Beverage | F&B Intern | Full-Time | `gamma` | `efd11863-7463-4cda-b394-b87990362881` |
| 92 | Barbara Jones | `test92@test.com` | `test92` | `ICC-1092` | Event Delivery | Event Food & Beverage | Event Delivery Supervisor | Part-Time | `beta` | `9e4db21e-184a-4144-859a-7483bf154f44` |
| 93 | Richard Jones | `test93@test.com` | `test93` | `ICC-1093` | Event Delivery | Event Food & Beverage | Assistant F&B Floor Manager | Part-Time | `beta` | `7ff32029-7ad7-45cd-99f0-4e138b0a3af9` |
| 94 | Susan Jones | `test94@test.com` | `test94` | `ICC-1094` | Event Delivery | Event Food & Beverage | F&B Floor Manager | Casual | `alpha` | `5e57f05f-5678-4d06-aecb-99e055aa27d7` |
| 95 | Joseph Jones | `test95@test.com` | `test95` | `ICC-1095` | Event Delivery | Event Food & Beverage | F&B Senior Floor Manager | Full-Time | `alpha` | `8e1c1a85-246d-4272-933e-ab488b9be7ac` |
| 96 | Jessica Jones | `test96@test.com` | `test96` | `ICC-1096` | Event Delivery | Event Food & Beverage | Assistant Event Delivery Manager | Casual | `alpha` | `dc0ee6de-0f6b-4c5f-a8a7-c9ff9a993a95` |
| 97 | Thomas Jones | `test97@test.com` | `test97` | `ICC-1097` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `6df5d258-76db-4734-bc74-00ce26ccd40f` |
| 98 | Sarah Jones | `test98@test.com` | `test98` | `ICC-1098` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `2f8ae940-a6fd-4fc2-8fa1-92a10d1444b5` |
| 99 | Charles Jones | `test99@test.com` | `test99` | `ICC-1099` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `527b6706-8305-45af-b12f-6e6d3c087d74` |
| 100 | Karen Jones | `test100@test.com` | `test100` | `ICC-1100` | Event Delivery | Event Food & Beverage | F&B Team Member | Part-Time | `alpha` | `5fb76450-d607-4f64-9fcf-0fd7298651ff` |
| 101 | Maeve Mehta | `test101@test.com` | `test101` | `ICC-1101` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000101` |
| 102 | Kian Suzuki | `test102@test.com` | `test102` | `ICC-1102` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000102` |
| 103 | Billie de Jong | `test103@test.com` | `test103` | `ICC-1103` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000103` |
| 104 | Liam Tremblay | `test104@test.com` | `test104` | `ICC-1104` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000104` |
| 105 | Amelia Kim | `test105@test.com` | `test105` | `ICC-1105` | Event Delivery | Event Food & Beverage | F&B Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000105` |
| 106 | Arjun Moreau | `test106@test.com` | `test106` | `ICC-1106` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000106` |
| 107 | Isabella Alvarez | `test107@test.com` | `test107` | `ICC-1107` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000107` |
| 108 | Hugo Gupta | `test108@test.com` | `test108` | `ICC-1108` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000108` |
| 109 | Ella Mehta | `test109@test.com` | `test109` | `ICC-1109` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000109` |
| 110 | Daniel Suzuki | `test110@test.com` | `test110` | `ICC-1110` | Event Delivery | Event Food & Beverage | F&B Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000110` |
| 111 | Ivy de Jong | `test111@test.com` | `test111` | `ICC-1111` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000111` |
| 112 | Oscar Tremblay | `test112@test.com` | `test112` | `ICC-1112` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000112` |
| 113 | Aurora Kim | `test113@test.com` | `test113` | `ICC-1113` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000113` |
| 114 | Dev Moreau | `test114@test.com` | `test114` | `ICC-1114` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000114` |
| 115 | Violet Alvarez | `test115@test.com` | `test115` | `ICC-1115` | Event Delivery | Event Food & Beverage | F&B Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000115` |
| 116 | Ronan Gupta | `test116@test.com` | `test116` | `ICC-1116` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000116` |
| 117 | Sienna Mehta | `test117@test.com` | `test117` | `ICC-1117` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000117` |
| 118 | Caleb Suzuki | `test118@test.com` | `test118` | `ICC-1118` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000118` |
| 119 | Olivia de Jong | `test119@test.com` | `test119` | `ICC-1119` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000119` |
| 120 | Mateo Tremblay | `test120@test.com` | `test120` | `ICC-1120` | Event Delivery | Event Food & Beverage | F&B Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000120` |
| 121 | Aaliyah Kim | `test121@test.com` | `test121` | `ICC-1121` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000121` |
| 122 | Muhammad Moreau | `test122@test.com` | `test122` | `ICC-1122` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000122` |
| 123 | Harper Alvarez | `test123@test.com` | `test123` | `ICC-1123` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000123` |
| 124 | Gabriel Gupta | `test124@test.com` | `test124` | `ICC-1124` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000124` |
| 125 | Victoria Mehta | `test125@test.com` | `test125` | `ICC-1125` | Event Delivery | Event Food & Beverage | F&B Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000125` |
| 126 | Yusuf Suzuki | `test126@test.com` | `test126` | `ICC-1126` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000126` |
| 127 | Priya de Jong | `test127@test.com` | `test127` | `ICC-1127` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000127` |
| 128 | Brodie Tremblay | `test128@test.com` | `test128` | `ICC-1128` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000128` |
| 129 | Naomi Kim | `test129@test.com` | `test129` | `ICC-1129` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000129` |
| 130 | Fletcher Moreau | `test130@test.com` | `test130` | `ICC-1130` | Event Delivery | Event Food & Beverage | F&B Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000130` |
| 131 | Eliza Alvarez | `test131@test.com` | `test131` | `ICC-1131` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000131` |
| 132 | Bao Gupta | `test132@test.com` | `test132` | `ICC-1132` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000132` |
| 133 | Abigail Mehta | `test133@test.com` | `test133` | `ICC-1133` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000133` |
| 134 | Noah Suzuki | `test134@test.com` | `test134` | `ICC-1134` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000134` |
| 135 | Aria de Jong | `test135@test.com` | `test135` | `ICC-1135` | Event Delivery | Event Food & Beverage | F&B Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000135` |
| 136 | Alexander Tremblay | `test136@test.com` | `test136` | `ICC-1136` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000136` |
| 137 | Sophie Kim | `test137@test.com` | `test137` | `ICC-1137` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000137` |
| 138 | Ravi Moreau | `test138@test.com` | `test138` | `ICC-1138` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000138` |
| 139 | Mila Alvarez | `test139@test.com` | `test139` | `ICC-1139` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000139` |
| 140 | Aiden Gupta | `test140@test.com` | `test140` | `ICC-1140` | Event Delivery | Event Food & Beverage | F&B Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000140` |
| 141 | Zara Mehta | `test141@test.com` | `test141` | `ICC-1141` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000141` |
| 142 | Leo Suzuki | `test142@test.com` | `test142` | `ICC-1142` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000142` |
| 143 | Leila de Jong | `test143@test.com` | `test143` | `ICC-1143` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000143` |
| 144 | Xavier Tremblay | `test144@test.com` | `test144` | `ICC-1144` | Event Delivery | Event Food & Beverage | F&B Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000144` |
| 145 | Imogen Kim | `test145@test.com` | `test145` | `ICC-1145` | Event Delivery | Event Food & Beverage | F&B Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000145` |
| 146 | Suresh Moreau | `test146@test.com` | `test146` | `ICC-1146` | Event Delivery | Retail & Beverage | Beverage Supervisor | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000146` |
| 147 | Phoebe Alvarez | `test147@test.com` | `test147` | `ICC-1147` | Event Delivery | Retail & Beverage | Café Supervisor | Full-Time | `beta` | `d1000000-0000-0000-0000-000000000147` |
| 148 | Toby Gupta | `test148@test.com` | `test148` | `ICC-1148` | Event Delivery | Retail & Beverage | Laneway Bar Supervisor | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000148` |
| 149 | Emma Mehta | `test149@test.com` | `test149` | `ICC-1149` | Event Delivery | Retail & Beverage | Event Delivery Supervisor | Casual | `alpha` | `d1000000-0000-0000-0000-000000000149` |
| 150 | Lucas Suzuki | `test150@test.com` | `test150` | `ICC-1150` | Event Delivery | Retail & Beverage | Retail Services Floor Manager | Full-Time | `alpha` | `d1000000-0000-0000-0000-000000000150` |
| 151 | Zoe de Jong | `test151@test.com` | `test151` | `ICC-1151` | Event Delivery | Retail & Beverage | Senior Retail Services Floor Manager | Casual | `alpha` | `d1000000-0000-0000-0000-000000000151` |
| 152 | Jack Tremblay | `test152@test.com` | `test152` | `ICC-1152` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000152` |
| 153 | Camila Kim | `test153@test.com` | `test153` | `ICC-1153` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000153` |
| 154 | Hiroshi Moreau | `test154@test.com` | `test154` | `ICC-1154` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000154` |
| 155 | Elena Alvarez | `test155@test.com` | `test155` | `ICC-1155` | Event Delivery | Retail & Beverage | Beverage Team Leader | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000155` |
| 156 | Cooper Gupta | `test156@test.com` | `test156` | `ICC-1156` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000156` |
| 157 | Fatima Mehta | `test157@test.com` | `test157` | `ICC-1157` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000157` |
| 158 | Hamish Suzuki | `test158@test.com` | `test158` | `ICC-1158` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000158` |
| 159 | Alice de Jong | `test159@test.com` | `test159` | `ICC-1159` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000159` |
| 160 | Callum Tremblay | `test160@test.com` | `test160` | `ICC-1160` | Event Delivery | Retail & Beverage | Beverage Team Leader | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000160` |
| 161 | Hazel Kim | `test161@test.com` | `test161` | `ICC-1161` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000161` |
| 162 | Declan Moreau | `test162@test.com` | `test162` | `ICC-1162` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000162` |
| 163 | Natasha Alvarez | `test163@test.com` | `test163` | `ICC-1163` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000163` |
| 164 | Oliver Gupta | `test164@test.com` | `test164` | `ICC-1164` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000164` |
| 165 | Mia Mehta | `test165@test.com` | `test165` | `ICC-1165` | Event Delivery | Retail & Beverage | Beverage Team Leader | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000165` |
| 166 | Wei Suzuki | `test166@test.com` | `test166` | `ICC-1166` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000166` |
| 167 | Maya de Jong | `test167@test.com` | `test167` | `ICC-1167` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000167` |
| 168 | Lachlan Tremblay | `test168@test.com` | `test168` | `ICC-1168` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000168` |
| 169 | Scarlett Kim | `test169@test.com` | `test169` | `ICC-1169` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000169` |
| 170 | Kavita Moreau | `test170@test.com` | `test170` | `ICC-1170` | Event Delivery | Retail & Beverage | Beverage Team Leader | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000170` |
| 171 | Ruby Alvarez | `test171@test.com` | `test171` | `ICC-1171` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000171` |
| 172 | Finn Gupta | `test172@test.com` | `test172` | `ICC-1172` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000172` |
| 173 | Penelope Mehta | `test173@test.com` | `test173` | `ICC-1173` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000173` |
| 174 | Jian Suzuki | `test174@test.com` | `test174` | `ICC-1174` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000174` |
| 175 | Emilia de Jong | `test175@test.com` | `test175` | `ICC-1175` | Event Delivery | Retail & Beverage | Beverage Team Leader | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000175` |
| 176 | Ezekiel Tremblay | `test176@test.com` | `test176` | `ICC-1176` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000176` |
| 177 | Sari Kim | `test177@test.com` | `test177` | `ICC-1177` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000177` |
| 178 | Kieran Moreau | `test178@test.com` | `test178` | `ICC-1178` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000178` |
| 179 | Charlotte Alvarez | `test179@test.com` | `test179` | `ICC-1179` | Event Delivery | Retail & Beverage | Beverage Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000179` |
| 180 | Kenji Gupta | `test180@test.com` | `test180` | `ICC-1180` | Event Delivery | Retail & Beverage | Beverage Team Leader | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000180` |
| 181 | Grace Mehta | `test181@test.com` | `test181` | `ICC-1181` | Event Delivery | F&B Coordination | Casual F&B Coordinator – Rostering | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000181` |
| 182 | Aarav Suzuki | `test182@test.com` | `test182` | `ICC-1182` | Event Delivery | F&B Coordination | Assistant F&B Services Manager | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000182` |
| 183 | Layla de Jong | `test183@test.com` | `test183` | `ICC-1183` | Event Delivery | F&B Coordination | F&B Services Coordinator | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000183` |
| 184 | Zayn Tremblay | `test184@test.com` | `test184` | `ICC-1184` | Event Delivery | F&B Coordination | Event Delivery Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000184` |
| 185 | Freya Kim | `test185@test.com` | `test185` | `ICC-1185` | Event Delivery | F&B Coordination | Event Delivery Coordinator | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000185` |
| 186 | Dimitri Moreau | `test186@test.com` | `test186` | `ICC-1186` | Event Delivery | F&B Coordination | Event Delivery Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000186` |
| 187 | Stella Alvarez | `test187@test.com` | `test187` | `ICC-1187` | Event Delivery | F&B Coordination | Event Delivery Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000187` |
| 188 | Sora Gupta | `test188@test.com` | `test188` | `ICC-1188` | Event Delivery | F&B Coordination | Event Delivery Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000188` |
| 189 | Piper Mehta | `test189@test.com` | `test189` | `ICC-1189` | Event Delivery | F&B Coordination | Event Delivery Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000189` |
| 190 | Zubair Suzuki | `test190@test.com` | `test190` | `ICC-1190` | Event Delivery | F&B Coordination | Event Delivery Coordinator | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000190` |
| 191 | Georgia de Jong | `test191@test.com` | `test191` | `ICC-1191` | Events | Event Setup | Assistant Manager, Event Setup | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000191` |
| 192 | Hassan Tremblay | `test192@test.com` | `test192` | `ICC-1192` | Events | Event Setup | Event Setup Coordinator | Full-Time | `beta` | `d1000000-0000-0000-0000-000000000192` |
| 193 | Ananya Kim | `test193@test.com` | `test193` | `ICC-1193` | Events | Event Setup | Manager, Event Setup | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000193` |
| 194 | Elijah Moreau | `test194@test.com` | `test194` | `ICC-1194` | Events | Event Setup | Event Setup Supervisor | Casual | `alpha` | `d1000000-0000-0000-0000-000000000194` |
| 195 | Chloe Alvarez | `test195@test.com` | `test195` | `ICC-1195` | Events | Event Setup | Event Setup Team Leader | Full-Time | `alpha` | `d1000000-0000-0000-0000-000000000195` |
| 196 | Tariq Gupta | `test196@test.com` | `test196` | `ICC-1196` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000196` |
| 197 | Hannah Mehta | `test197@test.com` | `test197` | `ICC-1197` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000197` |
| 198 | Ethan Suzuki | `test198@test.com` | `test198` | `ICC-1198` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000198` |
| 199 | Nora de Jong | `test199@test.com` | `test199` | `ICC-1199` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000199` |
| 200 | Marcus Tremblay | `test200@test.com` | `test200` | `ICC-1200` | Events | Event Setup | Event Setup Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000200` |
| 201 | Audrey Kim | `test201@test.com` | `test201` | `ICC-1201` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000201` |
| 202 | Siddharth Moreau | `test202@test.com` | `test202` | `ICC-1202` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000202` |
| 203 | Claire Alvarez | `test203@test.com` | `test203` | `ICC-1203` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000203` |
| 204 | Hamza Gupta | `test204@test.com` | `test204` | `ICC-1204` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000204` |
| 205 | Maeve Mehta | `test205@test.com` | `test205` | `ICC-1205` | Events | Event Setup | Event Setup Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000205` |
| 206 | Kian Suzuki | `test206@test.com` | `test206` | `ICC-1206` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000206` |
| 207 | Billie de Jong | `test207@test.com` | `test207` | `ICC-1207` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000207` |
| 208 | Liam Tremblay | `test208@test.com` | `test208` | `ICC-1208` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000208` |
| 209 | Amelia Kim | `test209@test.com` | `test209` | `ICC-1209` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000209` |
| 210 | Arjun Moreau | `test210@test.com` | `test210` | `ICC-1210` | Events | Event Setup | Event Setup Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000210` |
| 211 | Isabella Alvarez | `test211@test.com` | `test211` | `ICC-1211` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000211` |
| 212 | Hugo Gupta | `test212@test.com` | `test212` | `ICC-1212` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000212` |
| 213 | Ella Mehta | `test213@test.com` | `test213` | `ICC-1213` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000213` |
| 214 | Daniel Suzuki | `test214@test.com` | `test214` | `ICC-1214` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000214` |
| 215 | Ivy de Jong | `test215@test.com` | `test215` | `ICC-1215` | Events | Event Setup | Event Setup Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000215` |
| 216 | Oscar Tremblay | `test216@test.com` | `test216` | `ICC-1216` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000216` |
| 217 | Aurora Kim | `test217@test.com` | `test217` | `ICC-1217` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000217` |
| 218 | Dev Moreau | `test218@test.com` | `test218` | `ICC-1218` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000218` |
| 219 | Violet Alvarez | `test219@test.com` | `test219` | `ICC-1219` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000219` |
| 220 | Ronan Gupta | `test220@test.com` | `test220` | `ICC-1220` | Events | Event Setup | Event Setup Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000220` |
| 221 | Sienna Mehta | `test221@test.com` | `test221` | `ICC-1221` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000221` |
| 222 | Caleb Suzuki | `test222@test.com` | `test222` | `ICC-1222` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000222` |
| 223 | Olivia de Jong | `test223@test.com` | `test223` | `ICC-1223` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000223` |
| 224 | Mateo Tremblay | `test224@test.com` | `test224` | `ICC-1224` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000224` |
| 225 | Aaliyah Kim | `test225@test.com` | `test225` | `ICC-1225` | Events | Event Setup | Event Setup Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000225` |
| 226 | Muhammad Moreau | `test226@test.com` | `test226` | `ICC-1226` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000226` |
| 227 | Harper Alvarez | `test227@test.com` | `test227` | `ICC-1227` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000227` |
| 228 | Gabriel Gupta | `test228@test.com` | `test228` | `ICC-1228` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000228` |
| 229 | Victoria Mehta | `test229@test.com` | `test229` | `ICC-1229` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000229` |
| 230 | Yusuf Suzuki | `test230@test.com` | `test230` | `ICC-1230` | Events | Event Setup | Event Setup Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000230` |
| 231 | Priya de Jong | `test231@test.com` | `test231` | `ICC-1231` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000231` |
| 232 | Brodie Tremblay | `test232@test.com` | `test232` | `ICC-1232` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000232` |
| 233 | Naomi Kim | `test233@test.com` | `test233` | `ICC-1233` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000233` |
| 234 | Fletcher Moreau | `test234@test.com` | `test234` | `ICC-1234` | Events | Event Setup | Event Setup Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000234` |
| 235 | Eliza Alvarez | `test235@test.com` | `test235` | `ICC-1235` | Events | Event Setup | Event Setup Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000235` |
| 236 | Bao Gupta | `test236@test.com` | `test236` | `ICC-1236` | Events | Event Operations | Venue Manager (The Cutaway) | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000236` |
| 237 | Abigail Mehta | `test237@test.com` | `test237` | `ICC-1237` | Events | Event Operations | Event Services Floor Manager | Full-Time | `beta` | `d1000000-0000-0000-0000-000000000237` |
| 238 | Noah Suzuki | `test238@test.com` | `test238` | `ICC-1238` | Events | Event Operations | Senior Event Services Floor Manager | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000238` |
| 239 | Aria de Jong | `test239@test.com` | `test239` | `ICC-1239` | Events | Event Operations | Event Operations Manager | Casual | `alpha` | `d1000000-0000-0000-0000-000000000239` |
| 240 | Alexander Tremblay | `test240@test.com` | `test240` | `ICC-1240` | Events | Event Operations | Manager, Event Operations | Full-Time | `alpha` | `d1000000-0000-0000-0000-000000000240` |
| 241 | Sophie Kim | `test241@test.com` | `test241` | `ICC-1241` | Events | Event Operations | Senior Manager, Event Operations | Casual | `alpha` | `d1000000-0000-0000-0000-000000000241` |
| 242 | Ravi Moreau | `test242@test.com` | `test242` | `ICC-1242` | Events | Event Operations | Floor Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000242` |
| 243 | Mila Alvarez | `test243@test.com` | `test243` | `ICC-1243` | Events | Event Operations | Floor Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000243` |
| 244 | Aiden Gupta | `test244@test.com` | `test244` | `ICC-1244` | Events | Event Operations | Floor Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000244` |
| 245 | Zara Mehta | `test245@test.com` | `test245` | `ICC-1245` | Events | Event Operations | Floor Coordinator | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000245` |
| 246 | Leo Suzuki | `test246@test.com` | `test246` | `ICC-1246` | Events | Event Operations | Floor Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000246` |
| 247 | Leila de Jong | `test247@test.com` | `test247` | `ICC-1247` | Events | Event Operations | Floor Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000247` |
| 248 | Xavier Tremblay | `test248@test.com` | `test248` | `ICC-1248` | Events | Event Operations | Floor Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000248` |
| 249 | Imogen Kim | `test249@test.com` | `test249` | `ICC-1249` | Events | Event Operations | Floor Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000249` |
| 250 | Suresh Moreau | `test250@test.com` | `test250` | `ICC-1250` | Events | Event Operations | Floor Coordinator | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000250` |
| 251 | Phoebe Alvarez | `test251@test.com` | `test251` | `ICC-1251` | Events | Event Operations | Floor Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000251` |
| 252 | Toby Gupta | `test252@test.com` | `test252` | `ICC-1252` | Events | Event Operations | Floor Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000252` |
| 253 | Emma Mehta | `test253@test.com` | `test253` | `ICC-1253` | Events | Event Operations | Floor Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000253` |
| 254 | Lucas Suzuki | `test254@test.com` | `test254` | `ICC-1254` | Events | Event Operations | Floor Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000254` |
| 255 | Zoe de Jong | `test255@test.com` | `test255` | `ICC-1255` | Events | Event Operations | Floor Coordinator | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000255` |
| 256 | Jack Tremblay | `test256@test.com` | `test256` | `ICC-1256` | Events | Exhibition Services | Exhibition Floor Manager | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000256` |
| 257 | Camila Kim | `test257@test.com` | `test257` | `ICC-1257` | Events | Exhibition Services | Exhibition Services Supervisor | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000257` |
| 258 | Hiroshi Moreau | `test258@test.com` | `test258` | `ICC-1258` | Events | Exhibition Services | Exhibition Services Coordinator | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000258` |
| 259 | Elena Alvarez | `test259@test.com` | `test259` | `ICC-1259` | Events | Exhibition Services | Exhibition Services Assistant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000259` |
| 260 | Cooper Gupta | `test260@test.com` | `test260` | `ICC-1260` | Events | Exhibition Services | Exhibition Services Assistant | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000260` |
| 261 | Fatima Mehta | `test261@test.com` | `test261` | `ICC-1261` | Events | Exhibition Services | Exhibition Services Assistant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000261` |
| 262 | Hamish Suzuki | `test262@test.com` | `test262` | `ICC-1262` | Events | Exhibition Services | Exhibition Services Assistant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000262` |
| 263 | Alice de Jong | `test263@test.com` | `test263` | `ICC-1263` | Events | Exhibition Services | Exhibition Services Assistant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000263` |
| 264 | Callum Tremblay | `test264@test.com` | `test264` | `ICC-1264` | Events | Exhibition Services | Exhibition Services Assistant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000264` |
| 265 | Hazel Kim | `test265@test.com` | `test265` | `ICC-1265` | Events | Exhibition Services | Exhibition Services Assistant | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000265` |
| 266 | Declan Moreau | `test266@test.com` | `test266` | `ICC-1266` | Events | Exhibition Services | Exhibition Services Assistant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000266` |
| 267 | Natasha Alvarez | `test267@test.com` | `test267` | `ICC-1267` | Events | Exhibition Services | Exhibition Services Assistant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000267` |
| 268 | Oliver Gupta | `test268@test.com` | `test268` | `ICC-1268` | Events | Exhibition Services | Exhibition Services Assistant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000268` |
| 269 | Mia Mehta | `test269@test.com` | `test269` | `ICC-1269` | Events | Exhibition Services | Exhibition Services Assistant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000269` |
| 270 | Wei Suzuki | `test270@test.com` | `test270` | `ICC-1270` | Events | Exhibition Services | Exhibition Services Assistant | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000270` |
| 271 | Maya de Jong | `test271@test.com` | `test271` | `ICC-1271` | Audio Visual Services | AV Technical | Senior Systems Technician | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000271` |
| 272 | Lachlan Tremblay | `test272@test.com` | `test272` | `ICC-1272` | Audio Visual Services | AV Technical | Lighting Supervisor | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000272` |
| 273 | Scarlett Kim | `test273@test.com` | `test273` | `ICC-1273` | Audio Visual Services | AV Technical | Vision Manager | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000273` |
| 274 | Kavita Moreau | `test274@test.com` | `test274` | `ICC-1274` | Audio Visual Services | AV Technical | Audio Manager | Casual | `alpha` | `d1000000-0000-0000-0000-000000000274` |
| 275 | Ruby Alvarez | `test275@test.com` | `test275` | `ICC-1275` | Audio Visual Services | AV Technical | AV Manager | Full-Time | `alpha` | `d1000000-0000-0000-0000-000000000275` |
| 276 | Finn Gupta | `test276@test.com` | `test276` | `ICC-1276` | Audio Visual Services | AV Technical | AV Technical Manager | Casual | `alpha` | `d1000000-0000-0000-0000-000000000276` |
| 277 | Penelope Mehta | `test277@test.com` | `test277` | `ICC-1277` | Audio Visual Services | AV Technical | AV Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000277` |
| 278 | Jian Suzuki | `test278@test.com` | `test278` | `ICC-1278` | Audio Visual Services | AV Technical | AV Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000278` |
| 279 | Emilia de Jong | `test279@test.com` | `test279` | `ICC-1279` | Audio Visual Services | AV Technical | AV Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000279` |
| 280 | Ezekiel Tremblay | `test280@test.com` | `test280` | `ICC-1280` | Audio Visual Services | AV Technical | AV Technician | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000280` |
| 281 | Sari Kim | `test281@test.com` | `test281` | `ICC-1281` | Audio Visual Services | AV Technical | AV Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000281` |
| 282 | Kieran Moreau | `test282@test.com` | `test282` | `ICC-1282` | Audio Visual Services | AV Technical | AV Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000282` |
| 283 | Charlotte Alvarez | `test283@test.com` | `test283` | `ICC-1283` | Audio Visual Services | AV Technical | AV Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000283` |
| 284 | Kenji Gupta | `test284@test.com` | `test284` | `ICC-1284` | Audio Visual Services | AV Technical | AV Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000284` |
| 285 | Grace Mehta | `test285@test.com` | `test285` | `ICC-1285` | Audio Visual Services | AV Technical | AV Technician | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000285` |
| 286 | Aarav Suzuki | `test286@test.com` | `test286` | `ICC-1286` | Audio Visual Services | AV Technical | AV Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000286` |
| 287 | Layla de Jong | `test287@test.com` | `test287` | `ICC-1287` | Audio Visual Services | AV Technical | AV Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000287` |
| 288 | Zayn Tremblay | `test288@test.com` | `test288` | `ICC-1288` | Audio Visual Services | AV Technical | AV Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000288` |
| 289 | Freya Kim | `test289@test.com` | `test289` | `ICC-1289` | Audio Visual Services | AV Technical | AV Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000289` |
| 290 | Dimitri Moreau | `test290@test.com` | `test290` | `ICC-1290` | Audio Visual Services | AV Technical | AV Technician | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000290` |
| 291 | Stella Alvarez | `test291@test.com` | `test291` | `ICC-1291` | Audio Visual Services | AV Technical | AV Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000291` |
| 292 | Sora Gupta | `test292@test.com` | `test292` | `ICC-1292` | Audio Visual Services | AV Technical | AV Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000292` |
| 293 | Piper Mehta | `test293@test.com` | `test293` | `ICC-1293` | Audio Visual Services | AV Technical | AV Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000293` |
| 294 | Zubair Suzuki | `test294@test.com` | `test294` | `ICC-1294` | Audio Visual Services | AV Technical | AV Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000294` |
| 295 | Georgia de Jong | `test295@test.com` | `test295` | `ICC-1295` | Audio Visual Services | AV Technical | AV Technician | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000295` |
| 296 | Hassan Tremblay | `test296@test.com` | `test296` | `ICC-1296` | Audio Visual Services | AV Floor Operations | AV Floor Manager | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000296` |
| 297 | Ananya Kim | `test297@test.com` | `test297` | `ICC-1297` | Audio Visual Services | AV Floor Operations | AV Floor Manager | Full-Time | `beta` | `d1000000-0000-0000-0000-000000000297` |
| 298 | Elijah Moreau | `test298@test.com` | `test298` | `ICC-1298` | Audio Visual Services | AV Floor Operations | AV Floor Manager | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000298` |
| 299 | Chloe Alvarez | `test299@test.com` | `test299` | `ICC-1299` | Audio Visual Services | AV Floor Operations | AV Floor Manager | Casual | `alpha` | `d1000000-0000-0000-0000-000000000299` |
| 300 | Tariq Gupta | `test300@test.com` | `test300` | `ICC-1300` | Audio Visual Services | AV Floor Operations | AV Floor Manager | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000300` |
| 301 | Hannah Mehta | `test301@test.com` | `test301` | `ICC-1301` | Audio Visual Services | AV Floor Operations | AV Floor Manager | Casual | `alpha` | `d1000000-0000-0000-0000-000000000301` |
| 302 | Ethan Suzuki | `test302@test.com` | `test302` | `ICC-1302` | Audio Visual Services | AV Floor Operations | AV Floor Manager | Casual | `alpha` | `d1000000-0000-0000-0000-000000000302` |
| 303 | Nora de Jong | `test303@test.com` | `test303` | `ICC-1303` | Audio Visual Services | AV Floor Operations | AV Floor Manager | Casual | `alpha` | `d1000000-0000-0000-0000-000000000303` |
| 304 | Marcus Tremblay | `test304@test.com` | `test304` | `ICC-1304` | Audio Visual Services | AV Floor Operations | AV Floor Manager | Casual | `alpha` | `d1000000-0000-0000-0000-000000000304` |
| 305 | Audrey Kim | `test305@test.com` | `test305` | `ICC-1305` | Audio Visual Services | AV Floor Operations | AV Floor Manager | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000305` |
| 306 | Siddharth Moreau | `test306@test.com` | `test306` | `ICC-1306` | Audio Visual Services | AV Floor Operations | AV Floor Manager | Casual | `alpha` | `d1000000-0000-0000-0000-000000000306` |
| 307 | Claire Alvarez | `test307@test.com` | `test307` | `ICC-1307` | Audio Visual Services | AV Floor Operations | AV Floor Manager | Casual | `alpha` | `d1000000-0000-0000-0000-000000000307` |
| 308 | Hamza Gupta | `test308@test.com` | `test308` | `ICC-1308` | Audio Visual Services | AV Floor Operations | AV Floor Manager | Casual | `alpha` | `d1000000-0000-0000-0000-000000000308` |
| 309 | Maeve Mehta | `test309@test.com` | `test309` | `ICC-1309` | Audio Visual Services | AV Floor Operations | AV Floor Manager | Casual | `alpha` | `d1000000-0000-0000-0000-000000000309` |
| 310 | Kian Suzuki | `test310@test.com` | `test310` | `ICC-1310` | Audio Visual Services | AV Floor Operations | AV Floor Manager | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000310` |
| 311 | Billie de Jong | `test311@test.com` | `test311` | `ICC-1311` | Audio Visual Services | Staging & Production Crew | Screen & Media Trainee | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000311` |
| 312 | Liam Tremblay | `test312@test.com` | `test312` | `ICC-1312` | Audio Visual Services | Staging & Production Crew | AV Graduate Trainee | Full-Time | `beta` | `d1000000-0000-0000-0000-000000000312` |
| 313 | Amelia Kim | `test313@test.com` | `test313` | `ICC-1313` | Audio Visual Services | Staging & Production Crew | Staging & Sets Manager | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000313` |
| 314 | Arjun Moreau | `test314@test.com` | `test314` | `ICC-1314` | Audio Visual Services | Staging & Production Crew | AV Graduate | Casual | `alpha` | `d1000000-0000-0000-0000-000000000314` |
| 315 | Isabella Alvarez | `test315@test.com` | `test315` | `ICC-1315` | Audio Visual Services | Staging & Production Crew | AV Graduate | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000315` |
| 316 | Hugo Gupta | `test316@test.com` | `test316` | `ICC-1316` | Audio Visual Services | Staging & Production Crew | AV Graduate | Casual | `alpha` | `d1000000-0000-0000-0000-000000000316` |
| 317 | Ella Mehta | `test317@test.com` | `test317` | `ICC-1317` | Audio Visual Services | Staging & Production Crew | AV Graduate | Casual | `alpha` | `d1000000-0000-0000-0000-000000000317` |
| 318 | Daniel Suzuki | `test318@test.com` | `test318` | `ICC-1318` | Audio Visual Services | Staging & Production Crew | AV Graduate | Casual | `alpha` | `d1000000-0000-0000-0000-000000000318` |
| 319 | Ivy de Jong | `test319@test.com` | `test319` | `ICC-1319` | Audio Visual Services | Staging & Production Crew | AV Graduate | Casual | `alpha` | `d1000000-0000-0000-0000-000000000319` |
| 320 | Oscar Tremblay | `test320@test.com` | `test320` | `ICC-1320` | Audio Visual Services | Staging & Production Crew | AV Graduate | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000320` |
| 321 | Aurora Kim | `test321@test.com` | `test321` | `ICC-1321` | Audio Visual Services | Rigging | Rigging Manager | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000321` |
| 322 | Dev Moreau | `test322@test.com` | `test322` | `ICC-1322` | Audio Visual Services | Rigging | Rigging Technician | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000322` |
| 323 | Violet Alvarez | `test323@test.com` | `test323` | `ICC-1323` | Audio Visual Services | Rigging | Rigging Technician | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000323` |
| 324 | Ronan Gupta | `test324@test.com` | `test324` | `ICC-1324` | Audio Visual Services | Rigging | Rigging Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000324` |
| 325 | Sienna Mehta | `test325@test.com` | `test325` | `ICC-1325` | Audio Visual Services | Rigging | Rigging Technician | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000325` |
| 326 | Caleb Suzuki | `test326@test.com` | `test326` | `ICC-1326` | Audio Visual Services | Rigging | Rigging Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000326` |
| 327 | Olivia de Jong | `test327@test.com` | `test327` | `ICC-1327` | Audio Visual Services | Rigging | Rigging Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000327` |
| 328 | Mateo Tremblay | `test328@test.com` | `test328` | `ICC-1328` | Audio Visual Services | Rigging | Rigging Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000328` |
| 329 | Aaliyah Kim | `test329@test.com` | `test329` | `ICC-1329` | Audio Visual Services | Rigging | Rigging Technician | Casual | `alpha` | `d1000000-0000-0000-0000-000000000329` |
| 330 | Muhammad Moreau | `test330@test.com` | `test330` | `ICC-1330` | Audio Visual Services | Rigging | Rigging Technician | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000330` |
| 331 | Harper Alvarez | `test331@test.com` | `test331` | `ICC-1331` | Customer Services | Ushering | Team Leader Usher | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000331` |
| 332 | Gabriel Gupta | `test332@test.com` | `test332` | `ICC-1332` | Customer Services | Ushering | Usher | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000332` |
| 333 | Victoria Mehta | `test333@test.com` | `test333` | `ICC-1333` | Customer Services | Ushering | Usher | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000333` |
| 334 | Yusuf Suzuki | `test334@test.com` | `test334` | `ICC-1334` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000334` |
| 335 | Priya de Jong | `test335@test.com` | `test335` | `ICC-1335` | Customer Services | Ushering | Usher | Full-Time | `alpha` | `d1000000-0000-0000-0000-000000000335` |
| 336 | Brodie Tremblay | `test336@test.com` | `test336` | `ICC-1336` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000336` |
| 337 | Naomi Kim | `test337@test.com` | `test337` | `ICC-1337` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000337` |
| 338 | Fletcher Moreau | `test338@test.com` | `test338` | `ICC-1338` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000338` |
| 339 | Eliza Alvarez | `test339@test.com` | `test339` | `ICC-1339` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000339` |
| 340 | Bao Gupta | `test340@test.com` | `test340` | `ICC-1340` | Customer Services | Ushering | Usher | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000340` |
| 341 | Abigail Mehta | `test341@test.com` | `test341` | `ICC-1341` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000341` |
| 342 | Noah Suzuki | `test342@test.com` | `test342` | `ICC-1342` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000342` |
| 343 | Aria de Jong | `test343@test.com` | `test343` | `ICC-1343` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000343` |
| 344 | Alexander Tremblay | `test344@test.com` | `test344` | `ICC-1344` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000344` |
| 345 | Sophie Kim | `test345@test.com` | `test345` | `ICC-1345` | Customer Services | Ushering | Usher | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000345` |
| 346 | Ravi Moreau | `test346@test.com` | `test346` | `ICC-1346` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000346` |
| 347 | Mila Alvarez | `test347@test.com` | `test347` | `ICC-1347` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000347` |
| 348 | Aiden Gupta | `test348@test.com` | `test348` | `ICC-1348` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000348` |
| 349 | Zara Mehta | `test349@test.com` | `test349` | `ICC-1349` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000349` |
| 350 | Leo Suzuki | `test350@test.com` | `test350` | `ICC-1350` | Customer Services | Ushering | Usher | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000350` |
| 351 | Leila de Jong | `test351@test.com` | `test351` | `ICC-1351` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000351` |
| 352 | Xavier Tremblay | `test352@test.com` | `test352` | `ICC-1352` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000352` |
| 353 | Imogen Kim | `test353@test.com` | `test353` | `ICC-1353` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000353` |
| 354 | Suresh Moreau | `test354@test.com` | `test354` | `ICC-1354` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000354` |
| 355 | Phoebe Alvarez | `test355@test.com` | `test355` | `ICC-1355` | Customer Services | Ushering | Usher | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000355` |
| 356 | Toby Gupta | `test356@test.com` | `test356` | `ICC-1356` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000356` |
| 357 | Emma Mehta | `test357@test.com` | `test357` | `ICC-1357` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000357` |
| 358 | Lucas Suzuki | `test358@test.com` | `test358` | `ICC-1358` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000358` |
| 359 | Zoe de Jong | `test359@test.com` | `test359` | `ICC-1359` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000359` |
| 360 | Jack Tremblay | `test360@test.com` | `test360` | `ICC-1360` | Customer Services | Ushering | Usher | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000360` |
| 361 | Camila Kim | `test361@test.com` | `test361` | `ICC-1361` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000361` |
| 362 | Hiroshi Moreau | `test362@test.com` | `test362` | `ICC-1362` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000362` |
| 363 | Elena Alvarez | `test363@test.com` | `test363` | `ICC-1363` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000363` |
| 364 | Cooper Gupta | `test364@test.com` | `test364` | `ICC-1364` | Customer Services | Ushering | Usher | Casual | `alpha` | `d1000000-0000-0000-0000-000000000364` |
| 365 | Fatima Mehta | `test365@test.com` | `test365` | `ICC-1365` | Customer Services | Ushering | Usher | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000365` |
| 366 | Hamish Suzuki | `test366@test.com` | `test366` | `ICC-1366` | Customer Services | Customer Service | Customer Service Supervisor | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000366` |
| 367 | Alice de Jong | `test367@test.com` | `test367` | `ICC-1367` | Customer Services | Customer Service | Senior Customer Service Coordinator | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000367` |
| 368 | Callum Tremblay | `test368@test.com` | `test368` | `ICC-1368` | Customer Services | Customer Service | Customer Service Coordinator | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000368` |
| 369 | Hazel Kim | `test369@test.com` | `test369` | `ICC-1369` | Customer Services | Customer Service | Customer Service Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000369` |
| 370 | Declan Moreau | `test370@test.com` | `test370` | `ICC-1370` | Customer Services | Customer Service | Customer Service Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000370` |
| 371 | Natasha Alvarez | `test371@test.com` | `test371` | `ICC-1371` | Customer Services | Customer Service | Customer Service Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000371` |
| 372 | Oliver Gupta | `test372@test.com` | `test372` | `ICC-1372` | Customer Services | Customer Service | Customer Service Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000372` |
| 373 | Mia Mehta | `test373@test.com` | `test373` | `ICC-1373` | Customer Services | Customer Service | Customer Service Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000373` |
| 374 | Wei Suzuki | `test374@test.com` | `test374` | `ICC-1374` | Customer Services | Customer Service | Customer Service Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000374` |
| 375 | Maya de Jong | `test375@test.com` | `test375` | `ICC-1375` | Customer Services | Customer Service | Customer Service Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000375` |
| 376 | Lachlan Tremblay | `test376@test.com` | `test376` | `ICC-1376` | Customer Services | Customer Service | Customer Service Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000376` |
| 377 | Scarlett Kim | `test377@test.com` | `test377` | `ICC-1377` | Customer Services | Customer Service | Customer Service Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000377` |
| 378 | Kavita Moreau | `test378@test.com` | `test378` | `ICC-1378` | Customer Services | Customer Service | Customer Service Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000378` |
| 379 | Ruby Alvarez | `test379@test.com` | `test379` | `ICC-1379` | Customer Services | Customer Service | Customer Service Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000379` |
| 380 | Finn Gupta | `test380@test.com` | `test380` | `ICC-1380` | Customer Services | Customer Service | Customer Service Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000380` |
| 381 | Penelope Mehta | `test381@test.com` | `test381` | `ICC-1381` | Building Services | Presentation Services | Administration Assistant | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000381` |
| 382 | Jian Suzuki | `test382@test.com` | `test382` | `ICC-1382` | Building Services | Presentation Services | Cleaner Team Leader | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000382` |
| 383 | Emilia de Jong | `test383@test.com` | `test383` | `ICC-1383` | Building Services | Presentation Services | Assistant Manager | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000383` |
| 384 | Ezekiel Tremblay | `test384@test.com` | `test384` | `ICC-1384` | Building Services | Presentation Services | Presentation Services Manager | Casual | `alpha` | `d1000000-0000-0000-0000-000000000384` |
| 385 | Sari Kim | `test385@test.com` | `test385` | `ICC-1385` | Building Services | Presentation Services | Senior Manager | Full-Time | `alpha` | `d1000000-0000-0000-0000-000000000385` |
| 386 | Kieran Moreau | `test386@test.com` | `test386` | `ICC-1386` | Building Services | Presentation Services | Presentation Services Supervisor | Casual | `alpha` | `d1000000-0000-0000-0000-000000000386` |
| 387 | Charlotte Alvarez | `test387@test.com` | `test387` | `ICC-1387` | Building Services | Presentation Services | Cleaner | Casual | `alpha` | `d1000000-0000-0000-0000-000000000387` |
| 388 | Kenji Gupta | `test388@test.com` | `test388` | `ICC-1388` | Building Services | Presentation Services | Cleaner | Casual | `alpha` | `d1000000-0000-0000-0000-000000000388` |
| 389 | Grace Mehta | `test389@test.com` | `test389` | `ICC-1389` | Building Services | Presentation Services | Cleaner | Casual | `alpha` | `d1000000-0000-0000-0000-000000000389` |
| 390 | Aarav Suzuki | `test390@test.com` | `test390` | `ICC-1390` | Building Services | Presentation Services | Cleaner | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000390` |
| 391 | Layla de Jong | `test391@test.com` | `test391` | `ICC-1391` | Building Services | Presentation Services | Cleaner | Casual | `alpha` | `d1000000-0000-0000-0000-000000000391` |
| 392 | Zayn Tremblay | `test392@test.com` | `test392` | `ICC-1392` | Building Services | Presentation Services | Cleaner | Casual | `alpha` | `d1000000-0000-0000-0000-000000000392` |
| 393 | Freya Kim | `test393@test.com` | `test393` | `ICC-1393` | Building Services | Presentation Services | Cleaner | Casual | `alpha` | `d1000000-0000-0000-0000-000000000393` |
| 394 | Dimitri Moreau | `test394@test.com` | `test394` | `ICC-1394` | Building Services | Presentation Services | Cleaner | Casual | `alpha` | `d1000000-0000-0000-0000-000000000394` |
| 395 | Stella Alvarez | `test395@test.com` | `test395` | `ICC-1395` | Building Services | Presentation Services | Cleaner | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000395` |
| 396 | Sora Gupta | `test396@test.com` | `test396` | `ICC-1396` | Building Services | Presentation Services | Cleaner | Casual | `alpha` | `d1000000-0000-0000-0000-000000000396` |
| 397 | Piper Mehta | `test397@test.com` | `test397` | `ICC-1397` | Building Services | Presentation Services | Cleaner | Casual | `alpha` | `d1000000-0000-0000-0000-000000000397` |
| 398 | Zubair Suzuki | `test398@test.com` | `test398` | `ICC-1398` | Building Services | Presentation Services | Cleaner | Casual | `alpha` | `d1000000-0000-0000-0000-000000000398` |
| 399 | Georgia de Jong | `test399@test.com` | `test399` | `ICC-1399` | Building Services | Presentation Services | Cleaner | Casual | `alpha` | `d1000000-0000-0000-0000-000000000399` |
| 400 | Hassan Tremblay | `test400@test.com` | `test400` | `ICC-1400` | Building Services | Presentation Services | Cleaner | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000400` |
| 401 | Ananya Kim | `test401@test.com` | `test401` | `ICC-1401` | Building Services | Presentation Services | Cleaner | Casual | `alpha` | `d1000000-0000-0000-0000-000000000401` |
| 402 | Elijah Moreau | `test402@test.com` | `test402` | `ICC-1402` | Building Services | Presentation Services | Cleaner | Casual | `alpha` | `d1000000-0000-0000-0000-000000000402` |
| 403 | Chloe Alvarez | `test403@test.com` | `test403` | `ICC-1403` | Building Services | Presentation Services | Cleaner | Casual | `alpha` | `d1000000-0000-0000-0000-000000000403` |
| 404 | Tariq Gupta | `test404@test.com` | `test404` | `ICC-1404` | Building Services | Presentation Services | Cleaner | Casual | `alpha` | `d1000000-0000-0000-0000-000000000404` |
| 405 | Hannah Mehta | `test405@test.com` | `test405` | `ICC-1405` | Building Services | Presentation Services | Cleaner | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000405` |
| 406 | Ethan Suzuki | `test406@test.com` | `test406` | `ICC-1406` | Building Services | Car Park & Logistics | Logistics Administrator | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000406` |
| 407 | Nora de Jong | `test407@test.com` | `test407` | `ICC-1407` | Building Services | Car Park & Logistics | Traffic Logistics Supervisor | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000407` |
| 408 | Marcus Tremblay | `test408@test.com` | `test408` | `ICC-1408` | Building Services | Car Park & Logistics | Event Logistics Supervisor | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000408` |
| 409 | Audrey Kim | `test409@test.com` | `test409` | `ICC-1409` | Building Services | Car Park & Logistics | Car Park Attendant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000409` |
| 410 | Siddharth Moreau | `test410@test.com` | `test410` | `ICC-1410` | Building Services | Car Park & Logistics | Car Park Attendant | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000410` |
| 411 | Claire Alvarez | `test411@test.com` | `test411` | `ICC-1411` | Building Services | Car Park & Logistics | Car Park Attendant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000411` |
| 412 | Hamza Gupta | `test412@test.com` | `test412` | `ICC-1412` | Building Services | Car Park & Logistics | Car Park Attendant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000412` |
| 413 | Maeve Mehta | `test413@test.com` | `test413` | `ICC-1413` | Building Services | Car Park & Logistics | Car Park Attendant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000413` |
| 414 | Kian Suzuki | `test414@test.com` | `test414` | `ICC-1414` | Building Services | Car Park & Logistics | Car Park Attendant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000414` |
| 415 | Billie de Jong | `test415@test.com` | `test415` | `ICC-1415` | Building Services | Car Park & Logistics | Car Park Attendant | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000415` |
| 416 | Liam Tremblay | `test416@test.com` | `test416` | `ICC-1416` | Building Services | Car Park & Logistics | Car Park Attendant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000416` |
| 417 | Amelia Kim | `test417@test.com` | `test417` | `ICC-1417` | Building Services | Car Park & Logistics | Car Park Attendant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000417` |
| 418 | Arjun Moreau | `test418@test.com` | `test418` | `ICC-1418` | Building Services | Assets & Trades | Building Services Intern | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000418` |
| 419 | Isabella Alvarez | `test419@test.com` | `test419` | `ICC-1419` | Building Services | Assets & Trades | Trade Services Supervisor | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000419` |
| 420 | Hugo Gupta | `test420@test.com` | `test420` | `ICC-1420` | Building Services | Assets & Trades | Building Services Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000420` |
| 421 | Ella Mehta | `test421@test.com` | `test421` | `ICC-1421` | Building Services | Assets & Trades | Building Services Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000421` |
| 422 | Daniel Suzuki | `test422@test.com` | `test422` | `ICC-1422` | Building Services | Assets & Trades | Building Services Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000422` |
| 423 | Ivy de Jong | `test423@test.com` | `test423` | `ICC-1423` | Building Services | Assets & Trades | Building Services Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000423` |
| 424 | Oscar Tremblay | `test424@test.com` | `test424` | `ICC-1424` | Building Services | Assets & Trades | Building Services Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000424` |
| 425 | Aurora Kim | `test425@test.com` | `test425` | `ICC-1425` | Building Services | Assets & Trades | Building Services Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000425` |
| 426 | Dev Moreau | `test426@test.com` | `test426` | `ICC-1426` | Security & Risk | Event Security | Event Security Manager | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000426` |
| 427 | Violet Alvarez | `test427@test.com` | `test427` | `ICC-1427` | Security & Risk | Event Security | Event Security Supervisor | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000427` |
| 428 | Ronan Gupta | `test428@test.com` | `test428` | `ICC-1428` | Security & Risk | Event Security | Event Security Team Leader | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000428` |
| 429 | Sienna Mehta | `test429@test.com` | `test429` | `ICC-1429` | Security & Risk | Event Security | Event Security Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000429` |
| 430 | Caleb Suzuki | `test430@test.com` | `test430` | `ICC-1430` | Security & Risk | Event Security | Event Security Team Leader | Full-Time | `alpha` | `d1000000-0000-0000-0000-000000000430` |
| 431 | Olivia de Jong | `test431@test.com` | `test431` | `ICC-1431` | Security & Risk | Event Security | Event Security Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000431` |
| 432 | Mateo Tremblay | `test432@test.com` | `test432` | `ICC-1432` | Security & Risk | Event Security | Event Security Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000432` |
| 433 | Aaliyah Kim | `test433@test.com` | `test433` | `ICC-1433` | Security & Risk | Event Security | Event Security Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000433` |
| 434 | Muhammad Moreau | `test434@test.com` | `test434` | `ICC-1434` | Security & Risk | Event Security | Event Security Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000434` |
| 435 | Harper Alvarez | `test435@test.com` | `test435` | `ICC-1435` | Security & Risk | Event Security | Event Security Team Leader | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000435` |
| 436 | Gabriel Gupta | `test436@test.com` | `test436` | `ICC-1436` | Security & Risk | Event Security | Event Security Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000436` |
| 437 | Victoria Mehta | `test437@test.com` | `test437` | `ICC-1437` | Security & Risk | Event Security | Event Security Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000437` |
| 438 | Yusuf Suzuki | `test438@test.com` | `test438` | `ICC-1438` | Security & Risk | Event Security | Event Security Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000438` |
| 439 | Priya de Jong | `test439@test.com` | `test439` | `ICC-1439` | Security & Risk | Event Security | Event Security Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000439` |
| 440 | Brodie Tremblay | `test440@test.com` | `test440` | `ICC-1440` | Security & Risk | Event Security | Event Security Team Leader | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000440` |
| 441 | Naomi Kim | `test441@test.com` | `test441` | `ICC-1441` | Security & Risk | Event Security | Event Security Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000441` |
| 442 | Fletcher Moreau | `test442@test.com` | `test442` | `ICC-1442` | Security & Risk | Event Security | Event Security Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000442` |
| 443 | Eliza Alvarez | `test443@test.com` | `test443` | `ICC-1443` | Security & Risk | Event Security | Event Security Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000443` |
| 444 | Bao Gupta | `test444@test.com` | `test444` | `ICC-1444` | Security & Risk | Event Security | Event Security Team Leader | Casual | `alpha` | `d1000000-0000-0000-0000-000000000444` |
| 445 | Abigail Mehta | `test445@test.com` | `test445` | `ICC-1445` | Security & Risk | Event Security | Event Security Team Leader | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000445` |
| 446 | Noah Suzuki | `test446@test.com` | `test446` | `ICC-1446` | Security & Risk | Building Security | Security Guard | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000446` |
| 447 | Aria de Jong | `test447@test.com` | `test447` | `ICC-1447` | Security & Risk | Building Security | Assistant Building Security Manager | Full-Time | `beta` | `d1000000-0000-0000-0000-000000000447` |
| 448 | Alexander Tremblay | `test448@test.com` | `test448` | `ICC-1448` | Security & Risk | Building Security | Building Security Manager | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000448` |
| 449 | Sophie Kim | `test449@test.com` | `test449` | `ICC-1449` | Security & Risk | Building Security | Security Officer | Casual | `alpha` | `d1000000-0000-0000-0000-000000000449` |
| 450 | Ravi Moreau | `test450@test.com` | `test450` | `ICC-1450` | Security & Risk | Building Security | Security Officer | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000450` |
| 451 | Mila Alvarez | `test451@test.com` | `test451` | `ICC-1451` | Security & Risk | Building Security | Security Officer | Casual | `alpha` | `d1000000-0000-0000-0000-000000000451` |
| 452 | Aiden Gupta | `test452@test.com` | `test452` | `ICC-1452` | Security & Risk | Building Security | Security Officer | Casual | `alpha` | `d1000000-0000-0000-0000-000000000452` |
| 453 | Zara Mehta | `test453@test.com` | `test453` | `ICC-1453` | Security & Risk | Building Security | Security Officer | Casual | `alpha` | `d1000000-0000-0000-0000-000000000453` |
| 454 | Leo Suzuki | `test454@test.com` | `test454` | `ICC-1454` | Security & Risk | Building Security | Security Officer | Casual | `alpha` | `d1000000-0000-0000-0000-000000000454` |
| 455 | Leila de Jong | `test455@test.com` | `test455` | `ICC-1455` | Security & Risk | Building Security | Security Officer | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000455` |
| 456 | Xavier Tremblay | `test456@test.com` | `test456` | `ICC-1456` | Security & Risk | First Aid | Venue First Aid Services Coordinator | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000456` |
| 457 | Imogen Kim | `test457@test.com` | `test457` | `ICC-1457` | Security & Risk | First Aid | First Aid Officer | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000457` |
| 458 | Suresh Moreau | `test458@test.com` | `test458` | `ICC-1458` | Security & Risk | First Aid | First Aid Officer | Casual | `alpha` | `d1000000-0000-0000-0000-000000000458` |
| 459 | Phoebe Alvarez | `test459@test.com` | `test459` | `ICC-1459` | Security & Risk | First Aid | First Aid Officer | Casual | `alpha` | `d1000000-0000-0000-0000-000000000459` |
| 460 | Toby Gupta | `test460@test.com` | `test460` | `ICC-1460` | Security & Risk | First Aid | First Aid Officer | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000460` |
| 461 | Emma Mehta | `test461@test.com` | `test461` | `ICC-1461` | Live Entertainment | Live Event Operations | Live Production Trainee | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000461` |
| 462 | Lucas Suzuki | `test462@test.com` | `test462` | `ICC-1462` | Live Entertainment | Live Event Operations | Manager, Live Event Operations | Full-Time | `beta` | `d1000000-0000-0000-0000-000000000462` |
| 463 | Zoe de Jong | `test463@test.com` | `test463` | `ICC-1463` | Live Entertainment | Live Event Operations | Manager, Live Event Operations | Casual | `alpha` | `d1000000-0000-0000-0000-000000000463` |
| 464 | Jack Tremblay | `test464@test.com` | `test464` | `ICC-1464` | Live Entertainment | Live Event Operations | Manager, Live Event Operations | Casual | `alpha` | `d1000000-0000-0000-0000-000000000464` |
| 465 | Camila Kim | `test465@test.com` | `test465` | `ICC-1465` | Live Entertainment | Live Event Operations | Manager, Live Event Operations | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000465` |
| 466 | Hiroshi Moreau | `test466@test.com` | `test466` | `ICC-1466` | Live Entertainment | Live Event Operations | Manager, Live Event Operations | Casual | `alpha` | `d1000000-0000-0000-0000-000000000466` |
| 467 | Elena Alvarez | `test467@test.com` | `test467` | `ICC-1467` | Live Entertainment | Live Event Operations | Manager, Live Event Operations | Casual | `alpha` | `d1000000-0000-0000-0000-000000000467` |
| 468 | Cooper Gupta | `test468@test.com` | `test468` | `ICC-1468` | Live Entertainment | Live Event Operations | Manager, Live Event Operations | Casual | `alpha` | `d1000000-0000-0000-0000-000000000468` |
| 469 | Fatima Mehta | `test469@test.com` | `test469` | `ICC-1469` | Live Entertainment | Ticketing, Bookings & Merchandise | Ticketing & Bookings Coordinator | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000469` |
| 470 | Hamish Suzuki | `test470@test.com` | `test470` | `ICC-1470` | Live Entertainment | Ticketing, Bookings & Merchandise | Ticketing & Bookings Executive | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000470` |
| 471 | Alice de Jong | `test471@test.com` | `test471` | `ICC-1471` | Live Entertainment | Ticketing, Bookings & Merchandise | Merchandise Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000471` |
| 472 | Callum Tremblay | `test472@test.com` | `test472` | `ICC-1472` | Live Entertainment | Ticketing, Bookings & Merchandise | Merchandise Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000472` |
| 473 | Hazel Kim | `test473@test.com` | `test473` | `ICC-1473` | Live Entertainment | Ticketing, Bookings & Merchandise | Merchandise Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000473` |
| 474 | Declan Moreau | `test474@test.com` | `test474` | `ICC-1474` | Live Entertainment | Ticketing, Bookings & Merchandise | Merchandise Team Member | Casual | `alpha` | `d1000000-0000-0000-0000-000000000474` |
| 475 | Natasha Alvarez | `test475@test.com` | `test475` | `ICC-1475` | Live Entertainment | Ticketing, Bookings & Merchandise | Merchandise Team Member | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000475` |
| 476 | Oliver Gupta | `test476@test.com` | `test476` | `ICC-1476` | ICT Services | Service Desk & Support | ICT Support Analyst | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000476` |
| 477 | Mia Mehta | `test477@test.com` | `test477` | `ICC-1477` | ICT Services | Service Desk & Support | Senior ICT Support Technician | Full-Time | `beta` | `d1000000-0000-0000-0000-000000000477` |
| 478 | Wei Suzuki | `test478@test.com` | `test478` | `ICC-1478` | ICT Services | Service Desk & Support | ICT Graduate | Casual | `alpha` | `d1000000-0000-0000-0000-000000000478` |
| 479 | Maya de Jong | `test479@test.com` | `test479` | `ICC-1479` | ICT Services | Service Desk & Support | ICT Graduate | Casual | `alpha` | `d1000000-0000-0000-0000-000000000479` |
| 480 | Lachlan Tremblay | `test480@test.com` | `test480` | `ICC-1480` | ICT Services | Service Desk & Support | ICT Graduate | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000480` |
| 481 | Scarlett Kim | `test481@test.com` | `test481` | `ICC-1481` | ICT Services | Service Desk & Support | ICT Graduate | Casual | `alpha` | `d1000000-0000-0000-0000-000000000481` |
| 482 | Kavita Moreau | `test482@test.com` | `test482` | `ICC-1482` | ICT Services | Event Information Systems | EIS Specialist | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000482` |
| 483 | Ruby Alvarez | `test483@test.com` | `test483` | `ICC-1483` | ICT Services | Event Information Systems | EIS Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000483` |
| 484 | Finn Gupta | `test484@test.com` | `test484` | `ICC-1484` | ICT Services | Event Information Systems | EIS Coordinator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000484` |
| 485 | Penelope Mehta | `test485@test.com` | `test485` | `ICC-1485` | ICT Services | Event Information Systems | EIS Coordinator | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000485` |
| 486 | Jian Suzuki | `test486@test.com` | `test486` | `ICC-1486` | People & Culture | People Operations & Shared Services | People & Culture Administrator | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000486` |
| 487 | Emilia de Jong | `test487@test.com` | `test487` | `ICC-1487` | People & Culture | People Operations & Shared Services | HR Coordinator | Part-Time | `beta` | `d1000000-0000-0000-0000-000000000487` |
| 488 | Ezekiel Tremblay | `test488@test.com` | `test488` | `ICC-1488` | People & Culture | People Operations & Shared Services | HR Administrator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000488` |
| 489 | Sari Kim | `test489@test.com` | `test489` | `ICC-1489` | People & Culture | People Operations & Shared Services | HR Administrator | Casual | `alpha` | `d1000000-0000-0000-0000-000000000489` |
| 490 | Kieran Moreau | `test490@test.com` | `test490` | `ICC-1490` | People & Culture | People Operations & Shared Services | HR Administrator | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000490` |
| 491 | Charlotte Alvarez | `test491@test.com` | `test491` | `ICC-1491` | Finance & Administration | Accounts Payable & Receivable | Accounts Receivable Assistant | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000491` |
| 492 | Kenji Gupta | `test492@test.com` | `test492` | `ICC-1492` | Finance & Administration | Accounts Payable & Receivable | Accounts Assistant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000492` |
| 493 | Grace Mehta | `test493@test.com` | `test493` | `ICC-1493` | Finance & Administration | Accounts Payable & Receivable | Accounts Assistant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000493` |
| 494 | Aarav Suzuki | `test494@test.com` | `test494` | `ICC-1494` | Finance & Administration | Payroll | Payroll Manager | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000494` |
| 495 | Layla de Jong | `test495@test.com` | `test495` | `ICC-1495` | Finance & Administration | Payroll | Payroll Officer | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000495` |
| 496 | Zayn Tremblay | `test496@test.com` | `test496` | `ICC-1496` | Executive Office | Executive Support & Reception | Executive Assistant to the General Manager | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000496` |
| 497 | Freya Kim | `test497@test.com` | `test497` | `ICC-1497` | Executive Office | Executive Support & Reception | Administration Assistant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000497` |
| 498 | Dimitri Moreau | `test498@test.com` | `test498` | `ICC-1498` | Executive Office | Executive Support & Reception | Administration Assistant | Casual | `alpha` | `d1000000-0000-0000-0000-000000000498` |
| 499 | Stella Alvarez | `test499@test.com` | `test499` | `ICC-1499` | Executive Office | Legal & Compliance | Legal Counsel | Full-Time | `gamma` | `d1000000-0000-0000-0000-000000000499` |
| 500 | Sora Gupta | `test500@test.com` | `test500` | `ICC-1500` | Executive Office | Legal & Compliance | Senior Manager, Legal & Compliance | Part-Time | `alpha` | `d1000000-0000-0000-0000-000000000500` |