import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import { supabase } from './supabase';

export async function pickAndUploadAvatar(familyId: string): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Photo access needed', 'Enable photo library access in Settings to set a profile photo.');
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  });
  if (result.canceled || !result.assets[0]) return null;

  const uri = result.assets[0].uri;
  const ext = uri.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpg';
  const path = `${familyId}/photo.${ext}`;
  const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';

  const blob = await (await fetch(uri)).blob();
  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, blob, { contentType, upsert: true });
  if (uploadError) {
    Alert.alert('Upload failed', uploadError.message);
    return null;
  }

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  // Cache-bust so the new photo shows immediately instead of a stale CDN
  // copy at the same path.
  const photoUrl = `${data.publicUrl}?t=${Date.now()}`;

  const { error: updateError } = await supabase.from('families').update({ photo_url: photoUrl }).eq('id', familyId);
  if (updateError) {
    Alert.alert('Error', updateError.message);
    return null;
  }

  return photoUrl;
}

export async function removeAvatar(familyId: string): Promise<boolean> {
  const { error } = await supabase.from('families').update({ photo_url: null }).eq('id', familyId);
  if (error) {
    Alert.alert('Error', error.message);
    return false;
  }
  return true;
}
