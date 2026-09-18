-- Demo seed (가명만). Apply after migration when Supabase is connected.

insert into organizations (id, name, region, age_min, age_max, emergency_capable, availability) values
  ('org-a', '강남 청소년상담복지센터', '강남구', 13, 24, true, 'AVAILABLE'),
  ('org-b', '강남 학업지원센터', '강남구', 13, 18, false, 'AVAILABLE'),
  ('org-c', '서울 전역 심리지원단', '서울', 13, 24, true, 'WAITLIST'),
  ('org-d', '수원 청소년상담센터', '수원', 13, 24, true, 'AVAILABLE'),
  ('org-e', '강남 학교적응지원센터', '강남구', 13, 18, true, 'AVAILABLE')
on conflict (id) do nothing;

insert into services (id, organization_id, need_tags) values
  ('svc-a1', 'org-a', array['심리상담']),
  ('svc-b1', 'org-b', array['학업지원']),
  ('svc-c1', 'org-c', array['심리상담']),
  ('svc-d1', 'org-d', array['심리상담']),
  ('svc-e1', 'org-e', array['학교적응']),
  ('svc-a2', 'org-a', array['심리상담', '학교적응'])
on conflict (id) do nothing;
