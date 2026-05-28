import { supabase } from './supabase';

export interface CommunityActivityItem {
  id: string;
  event_type: string;
  source_type: string | null;
  source_id: string | null;
  username: string;
  created_at: string;
}

export interface WeeklyCommunitySnapshot {
  days: number;
  active_participants: number;
  event_participants: number;
  events: number;
  poll_votes: number;
  forum_posts: number;
  forum_comments: number;
  pending_scores: number;
  suspended_scores: number;
  resolved_scores: number;
}

export interface CommunityPollOption {
  id: string;
  option_key: string;
  sort_order: number;
  votes: number;
}

export interface CommunityPoll {
  id: string;
  slug: string;
  question_key: string;
  ends_at: string | null;
  selected_option_id: string | null;
  options: CommunityPollOption[];
}

export interface CommunityPollListItem {
  id: string;
  slug: string;
  question_key: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  vote_count: number;
}

export interface CommunityNotification {
  id: string;
  type: string;
  title_key: string;
  body_key: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ContributionValidationEvent {
  event_type: string;
  source_type: string | null;
  source_id: string | null;
  points: number;
  times?: number;
  metadata: Record<string, unknown>;
}

export interface ContributionValidationScore {
  id: string;
  user_id: string;
  username: string;
  base_points: number;
  like_points: number;
  poll_points: number;
  market_points: number;
  minigame_points: number;
  total_points: number;
  status: 'PENDING' | 'SUSPENDED' | 'RESOLVED';
  suspension_reason: string | null;
  top_events: ContributionValidationEvent[];
}

export interface ContributionValidationPeriod {
  id: string;
  period_start: string;
  period_end: string;
  status: 'OPEN' | 'VALIDATION' | 'RESOLVED';
  auto_resolves_at: string;
  resolved_at: string | null;
}

export interface ContributionValidationData {
  period: ContributionValidationPeriod | null;
  scores: ContributionValidationScore[];
}

const getResult = <T>(data: unknown, fallback: T): T => {
  const result = data as Partial<T> & { success?: boolean } | null;
  if (!result?.success) return fallback;
  return result as T;
};

export const logCommunityEngagement = async (
  eventType: string,
  sourceType?: string,
  sourceId?: string,
  metadata: Record<string, unknown> = {}
) => {
  try {
    const { error } = await supabase.rpc('log_community_engagement', {
      p_event_type: eventType,
      p_source_type: sourceType || null,
      p_source_id: sourceId || null,
      p_metadata: metadata
    });

    if (error) throw error;
  } catch (error) {
    console.error('Error logging community engagement:', error);
  }
};

export const fetchHomepageActivityFeed = async (limit = 10): Promise<CommunityActivityItem[]> => {
  const { data, error } = await supabase.rpc('get_homepage_activity_feed', { p_limit: limit });
  if (error) throw error;
  return getResult<{ items: CommunityActivityItem[] }>(data, { items: [] }).items || [];
};

export const updateMyPresence = async () => {
  const { error } = await supabase.rpc('update_my_presence');
  if (error) throw error;
};

export const fetchWeeklyCommunitySnapshot = async (days = 7): Promise<WeeklyCommunitySnapshot> => {
  const { data, error } = await supabase.rpc('get_weekly_community_snapshot', { p_days: days });
  if (error) throw error;
  return getResult<WeeklyCommunitySnapshot>(data, {
    days,
    active_participants: 0,
    event_participants: 0,
    events: 0,
    poll_votes: 0,
    forum_posts: 0,
    forum_comments: 0,
    pending_scores: 0,
    suspended_scores: 0,
    resolved_scores: 0
  });
};

export const fetchActiveCommunityPoll = async (roomId?: string): Promise<CommunityPoll | null> => {
  const { data, error } = await supabase.rpc('get_active_community_poll', {
    p_room_id: roomId || null
  });
  if (error) throw error;
  return data?.success ? data.poll : null;
};

export const castCommunityPollVote = async (pollId: string, optionId: string) => {
  const { data, error } = await supabase.rpc('cast_community_poll_vote', {
    p_poll_id: pollId,
    p_option_id: optionId
  });
  if (error) throw error;
  if (data && !data.success) throw new Error(data.message || 'Failed to vote');
  return data;
};

export const fetchUnreadCommunityNotifications = async (): Promise<CommunityNotification[]> => {
  const { data, error } = await supabase.rpc('get_unread_community_notifications');
  if (error) throw error;
  return getResult<{ items: CommunityNotification[] }>(data, { items: [] }).items || [];
};

export const markCommunityNotificationRead = async (notificationId: string) => {
  const { data, error } = await supabase.rpc('mark_community_notification_read', {
    p_notification_id: notificationId
  });
  if (error) throw error;
  if (data && !data.success) throw new Error(data.message || 'Failed to mark notification read');
};

export const fetchContributionValidation = async (): Promise<ContributionValidationData> => {
  const { data, error } = await supabase.rpc('get_developer_contribution_validation');
  if (error) throw error;
  if (data && !data.success) throw new Error(data.message || 'Failed to fetch contribution validation');
  return {
    period: data?.period || null,
    scores: data?.scores || []
  };
};

export const suspendContributionScore = async (scoreId: string, reason: string) => {
  const { data, error } = await supabase.rpc('suspend_weekly_contribution_score', {
    p_score_id: scoreId,
    p_reason: reason
  });
  if (error) throw error;
  if (data && !data.success) throw new Error(data.message || 'Failed to suspend contribution score');
};

export const unsuspendContributionScore = async (scoreId: string) => {
  const { data, error } = await supabase.rpc('unsuspend_weekly_contribution_score', {
    p_score_id: scoreId
  });
  if (error) throw error;
  if (data && !data.success) throw new Error(data.message || 'Failed to unsuspend contribution score');
};

export const refreshContributionScores = async () => {
  const { data, error } = await supabase.rpc('calculate_weekly_contribution_scores');
  if (error) throw error;
  if (data && !data.success) throw new Error(data.message || 'Failed to refresh contribution scores');
};

export const createCommunityPoll = async (
  slug: string,
  questionKey: string,
  options: { option_key: string }[],
  durationHours?: number
) => {
  const { data, error } = await supabase.rpc('create_community_poll', {
    p_slug: slug,
    p_question_key: questionKey,
    p_options: options,
    p_duration_hours: durationHours || null
  });
  if (error) throw error;
  if (data && !data.success) throw new Error(data.message || 'Failed to create poll');
  return data;
};

export const fetchAllCommunityPolls = async (): Promise<CommunityPollListItem[]> => {
  const { data, error } = await supabase.rpc('get_all_community_polls');
  if (error) throw error;
  if (data && !data.success) throw new Error(data.message || 'Failed to fetch polls');
  return data?.polls || [];
};

export const editCommunityPoll = async (pollId: string, questionKey: string, endsAt?: string) => {
  const { data, error } = await supabase.rpc('edit_community_poll', {
    p_poll_id: pollId,
    p_question_key: questionKey,
    p_ends_at: endsAt || null
  });
  if (error) throw error;
  if (data && !data.success) throw new Error(data.message || 'Failed to edit poll');
};

export const deleteCommunityPoll = async (pollId: string) => {
  const { data, error } = await supabase.rpc('delete_community_poll', {
    p_poll_id: pollId
  });
  if (error) throw error;
  if (data && !data.success) throw new Error(data.message || 'Failed to delete poll');
};

export const finalizeCommunityPoll = async (pollId: string) => {
  const { data, error } = await supabase.rpc('finalize_community_poll', {
    p_poll_id: pollId
  });
  if (error) throw error;
  if (data && !data.success) throw new Error(data.message || 'Failed to finalize poll');
};
