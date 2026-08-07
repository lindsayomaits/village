export type KidEntry = {
  name: string;
  birthday: string | null; // ISO "YYYY-MM-DD"
};

export type Family = {
  id: string;
  user_id: string;
  partner_user_id: string | null;
  kids_data: KidEntry[] | null;
  name: string;
  email: string;
  hours_balance: number;
  is_admin: boolean;
  is_active: boolean;
  connect_code: string | null;
  discoverable: boolean;
  push_token: string | null;
  partner_push_token: string | null;
  phone: string | null;
  kids_info: string | null;
  animal: string | null;
  village_notifications: 'all' | 'mentions' | 'muted' | null;
  services_offered: string[] | null;
  parent1_name: string | null;
  parent1_phone: string | null;
  parent2_name: string | null;
  parent2_phone: string | null;
  address: string | null;
  emergency_contact: string | null;
  created_at: string;
};

export type PostReaction = {
  id: string;
  post_id: string;
  family_id: string;
  emoji: string;
  created_at: string;
};

export type Post = {
  id: string;
  family_id: string;
  family?: Family;
  body: string;
  created_at: string;
  reactions?: PostReaction[];
};

export type DirectMessage = {
  id: string;
  from_family_id: string;
  to_family_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type RequestCategory = 'kid_sit' | 'dog' | 'manual_labor' | 'professional' | 'cooking' | 'elder_care' | 'physical_training' | 'errands';

export type CategoryDetails =
  | { location: 'kids_house' | 'sitters_house' | 'both' }
  | { pet_name: string; dog_task: 'walk' | 'boarding' | 'house_check' }
  | { labor_description: string; actual_hours: number; timing_flexible?: boolean }
  | { service_type: string; timing_flexible?: boolean }
  | { cooking_type: string; timing_flexible?: boolean }
  | { elder_care_type: string; timing_flexible?: boolean }
  | { training_type: string; timing_flexible?: boolean }
  | { errand_type: string; timing_flexible?: boolean }
  | null;

export type Request = {
  id: string;
  requesting_family_id: string;
  requesting_family?: Family;
  title: string;
  kid_name: string | null;
  notes: string | null;
  date: string;
  start_time: string;
  duration_hours: number;
  status: 'open' | 'offered' | 'accepted' | 'completed' | 'cancelled';
  fulfilling_family_id: string | null;
  fulfilling_family?: Family;
  is_overnight: boolean;
  end_date: string | null;
  end_time: string | null;
  category: RequestCategory;
  category_details: CategoryDetails;
  post_type: 'request' | 'offering';
  target_household_id: string | null;
  target_household?: Family;
  created_at: string;
};

export type Transaction = {
  id: string;
  from_family_id: string;
  from_family?: Family;
  to_family_id: string;
  to_family?: Family;
  hours: number;
  request_id: string | null;
  note: string | null;
  created_at: string;
};

export type MentionTarget = 'primary' | 'partner' | 'both';

export type Connection = {
  id: string;
  requester_id: string;
  requester?: Family;
  recipient_id: string;
  recipient?: Family;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
};

export type Block = {
  id: string;
  blocker_id: string;
  blocked_id: string;
  blocked?: Family;
  created_at: string;
};

export type Report = {
  id: string;
  reporter_id: string;
  reporter?: Family;
  reported_id: string;
  reported?: Family;
  reason: string;
  note: string | null;
  status: 'open' | 'reviewed' | 'dismissed';
  created_at: string;
};

export type Invite = {
  id: string;
  code: string;
  created_by: string;
  used_by: string | null;
  created_at: string;
  used_at: string | null;
  invite_type: 'new_family' | 'partner';
  family_id: string | null;
};
