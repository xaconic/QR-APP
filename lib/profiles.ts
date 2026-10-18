import { supabase } from './supabase';

export type Role = 'student' | 'teacher' | 'admin';

export type Profile = {
  id: string;
  display_id: string | null;
  email: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  academic_level_id: string | null;
  course_id: string | null;
  year_level_id: string | null;
  section_id: string | null;
};

function isMissingColumnError(error: { code?: string; message: string }) {
  return error.code === '42703'
    || error.code === 'PGRST204'
    || (error.message.toLowerCase().includes('column')
      && error.message.toLowerCase().includes('does not exist'));
}

function toProfile(data: Record<string, unknown>): Profile | null {
  if (typeof data.id !== 'string'
    || typeof data.email !== 'string'
    || typeof data.role !== 'string'
    || !['student', 'teacher', 'admin'].includes(data.role)) {
    return null;
  }

  return {
    id: data.id,
    display_id: typeof data.display_id === 'string' ? data.display_id : null,
    email: data.email,
    full_name: typeof data.full_name === 'string' ? data.full_name : null,
    role: data.role as Role,
    is_active: typeof data.is_active === 'boolean' ? data.is_active : true,
    academic_level_id: typeof data.academic_level_id === 'string' ? data.academic_level_id : null,
    course_id: typeof data.course_id === 'string' ? data.course_id : null,
    year_level_id: typeof data.year_level_id === 'string' ? data.year_level_id : null,
    section_id: typeof data.section_id === 'string' ? data.section_id : null,
  };
}

async function loadProfileRow(
  userId: string,
  accessToken?: string,
): Promise<{ profile: Profile | null; error: string | null }> {
  if (!accessToken) {
    const { data, error } = await supabase.auth.getSession();
    if (error) return { profile: null, error: error.message };
    if (data.session?.user.id === userId) {
      accessToken = data.session.access_token;
    }
  }

  const profileRequest = supabase
    .from('profiles')
    .select('id, display_id, email, full_name, role, is_active, academic_level_id, course_id, year_level_id, section_id')
    .eq('id', userId);
  if (accessToken) profileRequest.setHeader('Authorization', `Bearer ${accessToken}`);
  const result = await profileRequest.maybeSingle();

  if (!result.error && result.data) {
    const profile = toProfile(result.data as Record<string, unknown>);
    return profile
      ? { profile, error: null }
      : { profile: null, error: 'The account profile contains an invalid role or required fields.' };
  }

  if (!result.error) return { profile: null, error: null };
  if (!isMissingColumnError(result.error)) {
    return { profile: null, error: result.error.message };
  }

  // Keep the profile screen usable while an older Supabase project is being
  // migrated and does not have display_id yet.
  const fallbackRequest = supabase
    .from('profiles')
    .select('id, email, full_name, role, is_active, academic_level_id, course_id, year_level_id, section_id')
    .eq('id', userId);
  if (accessToken) fallbackRequest.setHeader('Authorization', `Bearer ${accessToken}`);
  const fallback = await fallbackRequest.maybeSingle();

  if (fallback.error && isMissingColumnError(fallback.error)) {
    const minimalRequest = supabase
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('id', userId);
    if (accessToken) minimalRequest.setHeader('Authorization', 'Bearer ' + accessToken);
    const minimal = await minimalRequest.maybeSingle();
    if (minimal.error) return { profile: null, error: minimal.error.message };
    if (!minimal.data) return { profile: null, error: null };
    const profile = toProfile(minimal.data as Record<string, unknown>);
    return profile
      ? { profile, error: null }
      : { profile: null, error: 'The account profile contains an invalid role or required fields.' };
  }
  if (fallback.error) return { profile: null, error: fallback.error.message };
  if (!fallback.data) return { profile: null, error: null };
  const profile = toProfile(fallback.data as Record<string, unknown>);
  return profile
    ? { profile, error: null }
    : { profile: null, error: 'The account profile contains an invalid role or required fields.' };
}

export async function getProfileWithError(
  userId: string,
  accessToken?: string,
): Promise<{ profile: Profile | null; error: string | null }> {
  let token = accessToken;
  if (token) {
    const { data, error } = await supabase.auth.getUser(token);
    if (error) return { profile: null, error: error.message };
    if (data.user?.id !== userId) {
      return { profile: null, error: 'The active sign-in session does not match this account. Please sign in again.' };
    }
  } else {
    const { data, error } = await supabase.auth.getSession();
    if (error) return { profile: null, error: error.message };
    if (data.session?.user.id !== userId) {
      return { profile: null, error: 'The active sign-in session does not match this account. Please sign in again.' };
    }
    token = data.session.access_token;
  }

  const current = await loadProfileRow(userId, token);
  return current;
}

export async function getProfile(userId: string, accessToken?: string): Promise<Profile | null> {
  const { profile } = await getProfileWithError(userId, accessToken);
  return profile;
}

export async function updateProfile(
  userId: string,
  updates: { full_name?: string }
): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select('id')
    .maybeSingle();

  return {
    error: error?.message ?? (data ? null : 'Profile could not be updated. The account may be inactive.'),
  };
}
