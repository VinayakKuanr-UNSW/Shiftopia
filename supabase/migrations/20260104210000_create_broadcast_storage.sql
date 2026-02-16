-- Create storage bucket for broadcast attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'broadcast-attachments',
  'broadcast-attachments',
  true,
  52428800, -- 50MB limit
  ARRAY['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policy for the bucket
CREATE POLICY "Authenticated users can upload broadcast attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'broadcast-attachments');

CREATE POLICY "Authenticated users can view broadcast attachments"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'broadcast-attachments');

CREATE POLICY "Authenticated users can delete broadcast attachments"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'broadcast-attachments');
