import { supabase } from '@/integrations/supabase/client';

const BUCKET = 'avatars';
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export async function uploadAvatar(userId: string, file: File): Promise<{ url?: string; error?: string }> {
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) return { error: 'Please choose a PNG, JPEG, or WebP image.' };
  if (file.size > MAX_BYTES) return { error: 'Image must be smaller than 2 MB.' };

  const path = `${userId}/avatar.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) return { error: uploadError.message };

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  // Cache-bust: the path is stable across re-uploads (upsert), so without
  // this the browser/CDN would keep serving the previous image.
  const url = `${data.publicUrl}?v=${Date.now()}`;

  const { error: updateError } = await supabase.auth.updateUser({ data: { avatar_url: url } });
  if (updateError) return { error: updateError.message };

  return { url };
}
