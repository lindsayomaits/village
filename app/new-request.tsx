import { useState, useEffect } from 'react';
import {
  View, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert, Switch, FlatList,
} from 'react-native';
import { Text } from '../components/Text';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { notifyConnections, notifyFamily } from '../lib/notifications';
import { getFamilyAnimal } from '../lib/animals';
import type { RequestCategory, Family } from '../types';

const DURATION_OPTIONS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
const MAX_HOURS_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 12];
const TIME_PREFS = [
  { key: 'morning',   label: 'Morning',   sub: '8am–12pm' },
  { key: 'afternoon', label: 'Afternoon', sub: '12–5pm' },
  { key: 'evening',   label: 'Evening',   sub: '5–9pm' },
  { key: 'flexible',  label: 'Flexible',  sub: 'Any time' },
] as const;

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const CATEGORIES: { key: RequestCategory; emoji: string; label: string; sub: string; color: string; lightColor: string }[] = [
  { key: 'kid_sit',           emoji: '👧', label: 'Kid-sitting',      sub: 'Watching kids at home',                   color: colors.primary,  lightColor: colors.primaryLight },
  { key: 'dog',               emoji: '🐾', label: 'Pet care',          sub: 'Walking, boarding, or checking in on pets', color: colors.blue,     lightColor: colors.blueLight },
  { key: 'manual_labor',      emoji: '🔨', label: 'Manual labor',      sub: 'Garden, painting, moving, etc. · 2× rate',  color: colors.amber,    lightColor: colors.amberLight },
  { key: 'professional',      emoji: '🎓', label: 'Professional help', sub: 'Counseling, legal, tech, finance, and more', color: colors.sage,     lightColor: colors.sageLight },
  { key: 'cooking',           emoji: '🍳', label: 'Cooking / baking',  sub: 'Meal prep, baking, recipe help, and more',  color: colors.purple,   lightColor: colors.purpleLight },
  { key: 'elder_care',        emoji: '🤝', label: 'Elder care',        sub: 'Companionship, errands, or assistance',     color: '#D97706',       lightColor: '#FEF3C7' },
  { key: 'physical_training', emoji: '🏃', label: 'Physical training', sub: 'Running, yoga, weights, and more',          color: '#059669',       lightColor: '#D1FAE5' },
  { key: 'errands',           emoji: '🛒', label: 'Errands',           sub: 'Groceries, transport, pick-ups, and more',   color: '#0891B2',       lightColor: '#E0F2FE' },
];

const PROFESSIONAL_SERVICES = [
  { key: 'counseling', label: '💆 Counseling' },
  { key: 'legal',      label: '⚖️ Legal advice' },
  { key: 'computer',   label: '💻 Tech / computer help' },
  { key: 'sewing',     label: '🧵 Sewing / alterations' },
  { key: 'financial',  label: '💰 Financial / tax advice' },
  { key: 'medical',    label: '🏥 Health advice' },
  { key: 'career',     label: '📋 Career coaching' },
  { key: 'tutoring',   label: '📚 Tutoring' },
  { key: 'language',   label: '🌐 Language help' },
  { key: 'other',      label: '✏️ Other' },
];

const COOKING_TYPES = [
  { key: 'meal_prep', label: '🥘 Meal prep' },
  { key: 'baking',    label: '🎂 Baking' },
  { key: 'teaching',  label: '🍳 Teaching a recipe' },
  { key: 'batch',     label: '🍱 Batch cooking' },
  { key: 'desserts',  label: '🧁 Desserts' },
  { key: 'healthy',   label: '🥗 Healthy meals' },
  { key: 'other',     label: '✏️ Other' },
];

const ELDER_CARE_TYPES = [
  { key: 'companionship', label: '🫂 Companionship / visits' },
  { key: 'errands',       label: '🛒 Errands & shopping' },
  { key: 'transport',     label: '🚗 Transportation' },
  { key: 'meals',         label: '🍲 Meal delivery / prep' },
  { key: 'tech_help',     label: '💻 Tech help' },
  { key: 'medical',       label: '💊 Medication reminders' },
  { key: 'other',         label: '✏️ Other' },
];

const TRAINING_TYPES = [
  { key: 'running',  label: '🏃 Running / jogging' },
  { key: 'yoga',     label: '🧘 Yoga' },
  { key: 'weights',  label: '🏋️ Weight training' },
  { key: 'walking',  label: '🚶 Walking' },
  { key: 'cycling',  label: '🚴 Cycling' },
  { key: 'swimming', label: '🏊 Swimming' },
  { key: 'pilates',  label: '🤸 Pilates / stretching' },
  { key: 'other',    label: '✏️ Other' },
];

const ERRAND_TYPES = [
  { key: 'groceries',  label: '🛒 Grocery pick-up' },
  { key: 'transport',  label: '🚗 Transport / drive' },
  { key: 'pharmacy',   label: '💊 Pharmacy run' },
  { key: 'post',       label: '📮 Post office / mail' },
  { key: 'pickup',     label: '📦 Pick up a package / item' },
  { key: 'dropoff',    label: '🏠 Drop something off' },
  { key: 'airport',    label: '🛫 Airport transportation' },
  { key: 'other',      label: '✏️ Other' },
];

function toDateOnly(d: Date) { return d.toISOString().split('T')[0]; }
function toTimeDisplay(d: Date) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function toDateDisplay(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function calcOvernightHours(dropoffDate: Date, dropoffTime: Date, pickupDate: Date, pickupTime: Date) {
  const dropoff = new Date(dropoffDate.getFullYear(), dropoffDate.getMonth(), dropoffDate.getDate(), dropoffTime.getHours(), dropoffTime.getMinutes());
  const pickup  = new Date(pickupDate.getFullYear(),  pickupDate.getMonth(),  pickupDate.getDate(),  pickupTime.getHours(),  pickupTime.getMinutes());
  const actualHours = (pickup.getTime() - dropoff.getTime()) / 3600000;
  const charged = Math.round((actualHours / 2) * 2) / 2;
  return { actualHours: Math.round(actualHours * 10) / 10, charged: Math.max(0.5, charged) };
}

export default function NewRequestScreen() {
  const { family, refreshFamily } = useAuth();
  const router = useRouter();

  const [postType, setPostType] = useState<'request' | 'offering'>('request');
  const [category, setCategory] = useState<RequestCategory | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  // Direct request to a specific household
  const [sendDirect, setSendDirect] = useState(false);
  const [targetHousehold, setTargetHousehold] = useState<Family | null>(null);
  const [connectedHouseholds, setConnectedHouseholds] = useState<Family[]>([]);

  // kid_sit
  const [kidName, setKidName] = useState('');
  const [isOvernight, setIsOvernight] = useState(false);
  const [kidLocation, setKidLocation] = useState<'kids_house' | 'sitters_house' | 'both' | null>(null);

  // pet care
  const [petName, setPetName] = useState('');
  const [dogTask, setDogTask] = useState<'walk' | 'boarding' | 'house_check'>('boarding');

  // manual_labor
  const [laborDescription, setLaborDescription] = useState('');

  // professional
  const [serviceType, setServiceType] = useState('');
  const [serviceOther, setServiceOther] = useState('');

  // cooking
  const [cookingType, setCookingType] = useState('');
  const [cookingOther, setCookingOther] = useState('');

  // elder_care
  const [elderCareType, setElderCareType] = useState('');
  const [elderCareOther, setElderCareOther] = useState('');

  // physical_training
  const [trainingType, setTrainingType] = useState('');
  const [trainingOther, setTrainingOther] = useState('');

  // errands
  const [errandType, setErrandType] = useState('');
  const [errandOther, setErrandOther] = useState('');

  // request time preference (when timingFlexible is on)
  const [requestTimePref, setRequestTimePref] = useState<'morning' | 'afternoon' | 'evening' | 'flexible'>('flexible');
  const [requestDays, setRequestDays] = useState<string[]>([]);
  const [availabilityDays, setAvailabilityDays] = useState<string[]>([]);

  // timing flexible (non-kidsit / dog categories)
  const [timingFlexible, setTimingFlexible] = useState(false);

  // Date / time / duration
  const [date, setDate] = useState(new Date());
  const [startTime, setStartTime] = useState(new Date());
  const [duration, setDuration] = useState<number>(2);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Offering availability range
  const [availabilityOpenEnded, setAvailabilityOpenEnded] = useState(false);
  const [availabilityEndDate, setAvailabilityEndDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 7); return d; });
  const [showAvailabilityEndDatePicker, setShowAvailabilityEndDatePicker] = useState(false);
  const [availabilityTimePref, setAvailabilityTimePref] = useState<'morning' | 'afternoon' | 'evening' | 'flexible'>('flexible');
  const [maxHours, setMaxHours] = useState<number>(3);

  // Overnight (kid_sit only)
  const [dropoffDate, setDropoffDate] = useState(new Date());
  const [dropoffTime, setDropoffTime] = useState(() => { const d = new Date(); d.setHours(18, 0, 0, 0); return d; });
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const [pickupDate, setPickupDate] = useState(tomorrow);
  const [pickupTime, setPickupTime] = useState(() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d; });
  const [showDropoffDate, setShowDropoffDate] = useState(false);
  const [showDropoffTime, setShowDropoffTime] = useState(false);
  const [showPickupDate, setShowPickupDate] = useState(false);
  const [showPickupTime, setShowPickupTime] = useState(false);

  const overnight = calcOvernightHours(dropoffDate, dropoffTime, pickupDate, pickupTime);
  const baseDuration = ((category === 'kid_sit' || (category === 'dog' && dogTask === 'boarding')) && isOvernight) ? overnight.charged : duration;
  const chargedHours = category === 'manual_labor' ? baseDuration * 2 : baseDuration;
  const newBalance = (family?.hours_balance ?? 0) - chargedHours;

  const isOffering = postType === 'offering';
  const catConfig = category ? CATEGORIES.find(c => c.key === category) : null;
  const themeColor = isOffering ? colors.green : colors.primary;
  const themeLightColor = isOffering ? colors.greenLight : colors.primaryLight;

  useEffect(() => {
    if (!family) return;
    supabase
      .from('connections')
      .select('requester_id, recipient_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${family.id},recipient_id.eq.${family.id}`)
      .then(async ({ data }) => {
        if (!data) return;
        const ids = data.map(c => c.requester_id === family.id ? c.recipient_id : c.requester_id);
        if (ids.length === 0) return;
        const { data: households } = await supabase.from('families').select('*').in('id', ids).order('name');
        setConnectedHouseholds(households ?? []);
      });
  }, [family]);

  function handleCategoryChange(next: RequestCategory) {
    setCategory(next);
    if (next !== 'kid_sit' && next !== 'dog') setIsOvernight(false);
    if (next !== 'kid_sit') setKidLocation(null);
  }

  function handlePostTypeChange(next: 'request' | 'offering') {
    setPostType(next);
    setIsOvernight(false);
    setCategory(null);
    setSendDirect(false);
    setTargetHousehold(null);
    setAvailabilityOpenEnded(false);
    setAvailabilityTimePref('flexible');
    setAvailabilityDays([]);
    setRequestTimePref('flexible');
    setRequestDays([]);
    setMaxHours(3);
  }

  async function handleSubmit() {
    if (!category) return Alert.alert('Please select a category');
    if (!title.trim()) return Alert.alert('Please add a title');
    if (category === 'kid_sit' && !kidLocation) return Alert.alert('Please select a location');
    if (!isOffering && category === 'dog' && !petName.trim()) return Alert.alert("Please enter your pet's name");
    if (category === 'manual_labor' && !laborDescription.trim()) return Alert.alert('Please describe the task');
    if (category === 'professional' && !serviceType) return Alert.alert('Please select a service type');
    if (category === 'professional' && serviceType === 'other' && !serviceOther.trim()) return Alert.alert('Please describe the service');
    if (category === 'cooking' && !cookingType) return Alert.alert('Please select a cooking type');
    if (category === 'cooking' && cookingType === 'other' && !cookingOther.trim()) return Alert.alert('Please describe the cooking help');
    if (category === 'elder_care' && !elderCareType) return Alert.alert('Please select an elder care type');
    if (category === 'physical_training' && !trainingType) return Alert.alert('Please select a training type');
    if (category === 'errands' && !errandType) return Alert.alert('Please select an errand type');
    if (sendDirect && !targetHousehold) return Alert.alert('Please select a household to send this to');
    if (postType === 'request' && category === 'kid_sit' && isOvernight && overnight.actualHours <= 0) {
      return Alert.alert('Invalid times', 'Pickup must be after drop-off.');
    }
    if (isOffering && !availabilityOpenEnded && availabilityEndDate <= date) {
      return Alert.alert('Invalid dates', '"Until" date must be after the start date.');
    }
    if (postType === 'request' && newBalance < -20) {
      return Alert.alert('Not enough hours', `This would bring your balance to ${newBalance}h, below the -20h limit.`);
    }

    const resolvedService = serviceType === 'other'
      ? serviceOther.trim()
      : PROFESSIONAL_SERVICES.find(s => s.key === serviceType)?.label ?? serviceType;

    const resolvedCooking = cookingType === 'other'
      ? cookingOther.trim()
      : COOKING_TYPES.find(s => s.key === cookingType)?.label ?? cookingType;

    const resolvedElderCare = elderCareType === 'other'
      ? elderCareOther.trim()
      : ELDER_CARE_TYPES.find(s => s.key === elderCareType)?.label ?? elderCareType;

    const resolvedTraining = trainingType === 'other'
      ? trainingOther.trim()
      : TRAINING_TYPES.find(s => s.key === trainingType)?.label ?? trainingType;

    const resolvedErrand = errandType === 'other'
      ? errandOther.trim()
      : ERRAND_TYPES.find(s => s.key === errandType)?.label ?? errandType;

    const categoryDetails =
      category === 'kid_sit'           ? { location: kidLocation! }
      : category === 'dog'             ? { pet_name: petName.trim(), dog_task: dogTask }
      : category === 'manual_labor'    ? { labor_description: laborDescription.trim(), actual_hours: duration, timing_flexible: timingFlexible || undefined }
      : category === 'professional'    ? { service_type: resolvedService, timing_flexible: timingFlexible || undefined }
      : category === 'cooking'         ? { cooking_type: resolvedCooking, timing_flexible: timingFlexible || undefined }
      : category === 'elder_care'      ? { elder_care_type: resolvedElderCare, timing_flexible: timingFlexible || undefined }
      : category === 'physical_training' ? { training_type: resolvedTraining, timing_flexible: timingFlexible || undefined }
      : category === 'errands'         ? { errand_type: resolvedErrand, timing_flexible: timingFlexible || undefined }
      : null;

    const useOvernight = postType === 'request' && (category === 'kid_sit' || (category === 'dog' && dogTask === 'boarding')) && isOvernight;
    const timePrefBase = TIME_PREFS.find(t => t.key === availabilityTimePref)?.label ?? 'Flexible';
    const timePrefLabel = availabilityDays.length > 0 ? `${timePrefBase} · ${availabilityDays.join(', ')}` : timePrefBase;
    const reqTimePrefBase = TIME_PREFS.find(t => t.key === requestTimePref)?.label ?? 'Flexible';
    const reqTimePrefLabel = requestDays.length > 0 ? `${reqTimePrefBase} · ${requestDays.join(', ')}` : reqTimePrefBase;

    setLoading(true);
    const { error } = await supabase.from('requests').insert({
      requesting_family_id: family?.id,
      post_type: postType,
      category,
      category_details: categoryDetails,
      title: title.trim(),
      kid_name: category === 'kid_sit' ? (kidName.trim() || null) : null,
      date: isOffering ? toDateOnly(date) : (useOvernight ? toDateOnly(dropoffDate) : toDateOnly(date)),
      start_time: isOffering
        ? timePrefLabel
        : useOvernight
          ? toTimeDisplay(dropoffTime)
          : timingFlexible
            ? reqTimePrefLabel
            : toTimeDisplay(startTime),
      end_date: isOffering
        ? (availabilityOpenEnded ? null : toDateOnly(availabilityEndDate))
        : (useOvernight ? toDateOnly(pickupDate) : null),
      end_time: isOffering ? null : (useOvernight ? toTimeDisplay(pickupTime) : null),
      duration_hours: isOffering ? maxHours : chargedHours,
      is_overnight: useOvernight,
      notes: notes.trim() || null,
      status: 'open',
      target_household_id: sendDirect && targetHousehold ? targetHousehold.id : null,
    });

    if (error) { setLoading(false); return Alert.alert('Error', error.message); }

    const catEmoji = catConfig?.emoji ?? '';
    const dateStr = toDateDisplay(isOffering ? date : (useOvernight ? dropoffDate : date));

    if (sendDirect && targetHousehold) {
      await notifyFamily(
        targetHousehold.id,
        `${catEmoji} Personal request from ${family?.name}`,
        `${family?.name} sent you a direct request: "${title.trim()}" on ${dateStr}`
      );
    } else if (postType === 'offering') {
      const rangeStr = availabilityOpenEnded
        ? `from ${dateStr} onwards`
        : `from ${dateStr} to ${toDateDisplay(availabilityEndDate)}`;
      await notifyConnections(family?.id ?? '', `${catEmoji} New availability posted`, `${family?.name} can help with ${category.replace(/_/g, ' ')} ${rangeStr} (up to ${maxHours}h)`);
    } else {
      await notifyConnections(
        family?.id ?? '',
        `${catEmoji} New request in VillageMates`,
        category === 'manual_labor'  ? `${family?.name} needs help: ${laborDescription.trim()} (${duration}h · ${chargedHours}h charged)`
        : category === 'dog' && isOvernight ? `${family?.name} needs overnight pet boarding — drop-off ${toDateDisplay(dropoffDate)}, pickup ${toDateDisplay(pickupDate)}`
        : category === 'dog' && dogTask === 'house_check' ? `${family?.name} needs a house check for ${petName.trim()} on ${dateStr}`
        : category === 'dog'         ? `${family?.name} needs a pet ${dogTask === 'walk' ? 'walk' : 'sitter'} on ${dateStr} for ${duration}h`
        : category === 'professional'? `${family?.name} needs ${resolvedService} on ${dateStr} for ${duration}h`
        : category === 'cooking'     ? `${family?.name} needs ${resolvedCooking} on ${dateStr} for ${duration}h`
        : category === 'elder_care'  ? `${family?.name} needs ${resolvedElderCare} on ${dateStr} for ${duration}h`
        : category === 'physical_training' ? `${family?.name} needs a ${resolvedTraining} partner on ${dateStr} for ${duration}h`
        : category === 'errands'     ? `${family?.name} needs help with ${resolvedErrand} on ${dateStr}`
        : isOvernight                ? `${family?.name} needs overnight care — drop-off ${toDateDisplay(dropoffDate)}, pickup ${toDateDisplay(pickupDate)}`
        : `${family?.name} needs a sitter on ${dateStr} for ${duration}h`
      );
    }

    if (postType === 'request') await refreshFamily();
    setLoading(false);
    router.back();
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.topRow}>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.back}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.screenTitle}>New Post</Text>
            <View style={{ width: 60 }} />
          </View>

          {/* Post type toggle */}
          <View style={styles.postTypeRow}>
            <TouchableOpacity
              style={[styles.postTypeBtn, !isOffering && styles.postTypeBtnActiveRequest]}
              onPress={() => handlePostTypeChange('request')}
            >
              <Text style={styles.postTypeEmoji}>📋</Text>
              <Text style={[styles.postTypeLabel, !isOffering && styles.postTypeLabelActiveRequest]}>I need help</Text>
              <Text style={[styles.postTypeSubLabel, !isOffering && styles.postTypeLabelActiveRequest]}>Post a Request</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.postTypeBtn, isOffering && styles.postTypeBtnActiveOffer]}
              onPress={() => handlePostTypeChange('offering')}
            >
              <Text style={styles.postTypeEmoji}>🙋</Text>
              <Text style={[styles.postTypeLabel, isOffering && styles.postTypeLabelActiveOffer]}>I can help</Text>
              <Text style={[styles.postTypeSubLabel, isOffering && styles.postTypeLabelActiveOffer]}>Post an Offer</Text>
            </TouchableOpacity>
          </View>

          {/* Category picker — collapsed once selected */}
          <Text style={styles.label}>
            {isOffering ? 'What can you help with?' : 'What do you need help with?'}{' '}
            <Text style={styles.required}>*</Text>
          </Text>

          {category === null ? (
            <View style={styles.categoryGrid}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.categoryCard, { borderColor: colors.border }]}
                  onPress={() => handleCategoryChange(c.key)}
                >
                  <Text style={styles.categoryEmoji}>{c.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.categoryLabel}>{c.label}</Text>
                    <Text style={styles.categorySub}>{c.sub}</Text>
                  </View>
                  <Text style={styles.categoryChevron}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={[styles.categorySelected, { backgroundColor: themeLightColor, borderColor: themeColor }]}>
              <Text style={styles.categorySelectedEmoji}>{catConfig?.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.categorySelectedLabel, { color: themeColor }]}>{catConfig?.label}</Text>
              </View>
              <TouchableOpacity onPress={() => { setCategory(null); setTitle(''); }} style={[styles.changeCategoryBtn, { borderColor: themeColor }]}>
                <Text style={[styles.changeCategoryText, { color: themeColor }]}>Change</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Only show rest of form once a category is selected */}
          {category !== null && (
            <>
              {/* Direct/personal request toggle (requests only) */}
              {postType === 'request' && connectedHouseholds.length > 0 && (
                <View style={[styles.directRow, { backgroundColor: themeLightColor, borderColor: themeColor + '60' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.directLabel, { color: themeColor }]}>🎯 Send directly</Text>
                    <Text style={styles.directSub}>Send to a specific household instead of everyone</Text>
                  </View>
                  <Switch
                    value={sendDirect}
                    onValueChange={v => { setSendDirect(v); if (!v) setTargetHousehold(null); }}
                    trackColor={{ false: colors.border, true: themeColor }}
                    thumbColor="#fff"
                  />
                </View>
              )}

              {/* Household picker for direct requests */}
              {sendDirect && (
                <>
                  <Text style={styles.label}>Send to <Text style={styles.required}>*</Text></Text>
                  <View style={styles.householdList}>
                    {connectedHouseholds.map(h => (
                      <TouchableOpacity
                        key={h.id}
                        style={[styles.householdChip, targetHousehold?.id === h.id && { backgroundColor: themeLightColor, borderColor: themeColor }]}
                        onPress={() => setTargetHousehold(h)}
                      >
                        <Text style={styles.householdChipAnimal}>{getFamilyAnimal(h.id, h.animal)}</Text>
                        <Text style={[styles.householdChipName, targetHousehold?.id === h.id && { color: themeColor }]}>{h.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {/* Title */}
              <Text style={styles.label}>Title <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={[styles.input, { borderColor: category ? themeColor + '60' : colors.border }]}
                placeholder={
                  isOffering
                    ? category === 'kid_sit'           ? 'e.g. Available Friday evening'
                    : category === 'dog'               ? 'e.g. Can watch pets Saturday morning'
                    : category === 'manual_labor'      ? 'e.g. Happy to help with yard work'
                    : category === 'professional'      ? 'e.g. Offering resume help'
                    : category === 'elder_care'        ? 'e.g. Happy to run errands Tuesday'
                    : category === 'physical_training' ? 'e.g. Running partner wanted Saturday'
                    : category === 'errands'           ? 'e.g. Can do grocery runs this week'
                    :                                    'e.g. Can meal prep Sunday afternoon'
                    : category === 'kid_sit'           ? 'e.g. Friday evening'
                    : category === 'dog'               ? 'e.g. Biscuit needs a Saturday walk'
                    : category === 'manual_labor'      ? 'e.g. Help painting the back fence'
                    : category === 'professional'      ? 'e.g. Help me with my resume'
                    : category === 'elder_care'        ? 'e.g. Mom needs a ride to her appointment'
                    : category === 'physical_training' ? 'e.g. Looking for a yoga partner'
                    : category === 'errands'           ? 'e.g. Need someone to grab groceries Saturday'
                    :                                    'e.g. Help with meal prep Sunday'
                }
                placeholderTextColor={colors.textMuted}
                value={title}
                onChangeText={setTitle}
              />

              {/* Kid-sit specific */}
              {category === 'kid_sit' && (
                <>
                  {!isOffering && (
                    <>
                      <Text style={styles.label}>Kid(s)</Text>
                      <TextInput style={[styles.input, { borderColor: themeColor + '60' }]} placeholder="e.g. Mia, or Mia & Jake"
                        placeholderTextColor={colors.textMuted} value={kidName} onChangeText={setKidName} />
                    </>
                  )}
                  {!isOffering && (
                    <View style={[styles.switchRow, { backgroundColor: themeLightColor, borderColor: themeColor + '40' }]}>
                      <View>
                        <Text style={styles.switchLabel}>🌙 Overnight stay</Text>
                        <Text style={styles.switchSub}>Hours charged at half rate</Text>
                      </View>
                      <Switch value={isOvernight} onValueChange={setIsOvernight}
                        trackColor={{ false: colors.border, true: themeColor }} thumbColor="#fff" />
                    </View>
                  )}
                  <Text style={styles.label}>
                    Location <Text style={styles.required}>*</Text>
                    {isOffering && <Text style={styles.labelHint}> · select all that apply</Text>}
                  </Text>
                  <View style={styles.segmentRow}>
                    {([
                      { key: 'kids_house',    label: "🏠 At the kid's house" },
                      { key: 'sitters_house', label: "🏡 At the sitter's house" },
                    ] as const).map(opt => {
                      const active = isOffering
                        ? (kidLocation === opt.key || kidLocation === 'both')
                        : kidLocation === opt.key;
                      return (
                        <TouchableOpacity key={opt.key}
                          style={[styles.segmentBtn, active && { backgroundColor: themeLightColor, borderColor: themeColor }]}
                          onPress={() => {
                            if (!isOffering) { setKidLocation(opt.key); return; }
                            if (kidLocation === null) setKidLocation(opt.key);
                            else if (kidLocation === opt.key) setKidLocation(null);
                            else if (kidLocation === 'both') setKidLocation(opt.key === 'kids_house' ? 'sitters_house' : 'kids_house');
                            else setKidLocation('both');
                          }}>
                          <Text style={[styles.segmentText, active && { color: themeColor, fontWeight: '700' }]}>{opt.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {/* Pet care specific */}
              {category === 'dog' && (
                <>
                  {!isOffering && (
                    <>
                      <Text style={styles.label}>Pet's name <Text style={styles.required}>*</Text></Text>
                      <TextInput style={[styles.input, { borderColor: themeColor + '60' }]} placeholder="e.g. Biscuit"
                        placeholderTextColor={colors.textMuted} value={petName} onChangeText={setPetName} />
                    </>
                  )}
                  <Text style={styles.label}>Type of care</Text>
                  <View style={styles.segmentRow}>
                    {([
                      { key: 'boarding',    label: '🏡 Boarding' },
                      { key: 'walk',        label: '🦮 Walking' },
                      { key: 'house_check', label: '🏠 House check' },
                    ] as const).map(t => (
                      <TouchableOpacity key={t.key}
                        style={[styles.segmentBtn, dogTask === t.key && { backgroundColor: themeLightColor, borderColor: themeColor }]}
                        onPress={() => { setDogTask(t.key); if (t.key !== 'boarding') setIsOvernight(false); }}>
                        <Text style={[styles.segmentText, dogTask === t.key && { color: themeColor, fontWeight: '700' }]}>{t.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {!isOffering && dogTask === 'boarding' && (
                    <View style={[styles.switchRow, { backgroundColor: themeLightColor, borderColor: themeColor + '40' }]}>
                      <View>
                        <Text style={styles.switchLabel}>🌙 Overnight stay</Text>
                        <Text style={styles.switchSub}>Hours charged at half rate</Text>
                      </View>
                      <Switch value={isOvernight} onValueChange={setIsOvernight}
                        trackColor={{ false: colors.border, true: themeColor }} thumbColor="#fff" />
                    </View>
                  )}
                </>
              )}

              {/* Manual labor specific */}
              {category === 'manual_labor' && (
                <>
                  <Text style={styles.label}>{isOffering ? 'What can you help with?' : 'What needs doing?'} <Text style={styles.required}>*</Text></Text>
                  <TextInput style={[styles.input, styles.textArea, { borderColor: themeColor + '60' }]}
                    placeholder={isOffering ? 'e.g. I can help with gardening, painting, moving furniture...' : 'e.g. Help planting the vegetable garden, painting the back fence...'}
                    placeholderTextColor={colors.textMuted} value={laborDescription}
                    onChangeText={setLaborDescription} multiline numberOfLines={3} />
                  <View style={[styles.rateBadge, { backgroundColor: themeLightColor, borderColor: themeColor + '40' }]}>
                    <Text style={[styles.rateText, { color: themeColor }]}>🔨 Manual labor is 2× rate — {isOffering ? 'you earn double' : 'helpers earn double'}</Text>
                  </View>
                </>
              )}

              {/* Professional specific */}
              {category === 'professional' && (
                <>
                  <Text style={styles.label}>Type of help <Text style={styles.required}>*</Text></Text>
                  <View style={styles.chipGrid}>
                    {PROFESSIONAL_SERVICES.map((s) => (
                      <TouchableOpacity key={s.key}
                        style={[styles.chip, serviceType === s.key && { backgroundColor: themeLightColor, borderColor: themeColor }]}
                        onPress={() => setServiceType(s.key)}>
                        <Text style={[styles.chipText, serviceType === s.key && { color: themeColor, fontWeight: '700' }]}>{s.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {serviceType === 'other' && (
                    <>
                      <Text style={styles.label}>Describe <Text style={styles.required}>*</Text></Text>
                      <TextInput style={[styles.input, { borderColor: themeColor + '60' }]} placeholder="e.g. Resume writing, photography tips..."
                        placeholderTextColor={colors.textMuted} value={serviceOther} onChangeText={setServiceOther} />
                    </>
                  )}
                </>
              )}

              {/* Cooking specific */}
              {category === 'cooking' && (
                <>
                  <Text style={styles.label}>Type of help <Text style={styles.required}>*</Text></Text>
                  <View style={styles.chipGrid}>
                    {COOKING_TYPES.map((s) => (
                      <TouchableOpacity key={s.key}
                        style={[styles.chip, cookingType === s.key && { backgroundColor: themeLightColor, borderColor: themeColor }]}
                        onPress={() => setCookingType(s.key)}>
                        <Text style={[styles.chipText, cookingType === s.key && { color: themeColor, fontWeight: '700' }]}>{s.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {cookingType === 'other' && (
                    <>
                      <Text style={styles.label}>Describe <Text style={styles.required}>*</Text></Text>
                      <TextInput style={[styles.input, { borderColor: themeColor + '60' }]} placeholder="e.g. Freezer meal prep, teaching sourdough..."
                        placeholderTextColor={colors.textMuted} value={cookingOther} onChangeText={setCookingOther} />
                    </>
                  )}
                </>
              )}

              {/* Elder care specific */}
              {category === 'elder_care' && (
                <>
                  <Text style={styles.label}>Type of help <Text style={styles.required}>*</Text></Text>
                  <View style={styles.chipGrid}>
                    {ELDER_CARE_TYPES.map((s) => (
                      <TouchableOpacity key={s.key}
                        style={[styles.chip, elderCareType === s.key && { backgroundColor: themeLightColor, borderColor: themeColor }]}
                        onPress={() => setElderCareType(s.key)}>
                        <Text style={[styles.chipText, elderCareType === s.key && { color: themeColor, fontWeight: '700' }]}>{s.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {elderCareType === 'other' && (
                    <>
                      <Text style={styles.label}>Describe <Text style={styles.required}>*</Text></Text>
                      <TextInput style={[styles.input, { borderColor: themeColor + '60' }]} placeholder="e.g. Help sorting mail, companionship..."
                        placeholderTextColor={colors.textMuted} value={elderCareOther} onChangeText={setElderCareOther} />
                    </>
                  )}
                </>
              )}

              {/* Physical training specific */}
              {category === 'physical_training' && (
                <>
                  <Text style={styles.label}>Type of activity <Text style={styles.required}>*</Text></Text>
                  <View style={styles.chipGrid}>
                    {TRAINING_TYPES.map((s) => (
                      <TouchableOpacity key={s.key}
                        style={[styles.chip, trainingType === s.key && { backgroundColor: themeLightColor, borderColor: themeColor }]}
                        onPress={() => setTrainingType(s.key)}>
                        <Text style={[styles.chipText, trainingType === s.key && { color: themeColor, fontWeight: '700' }]}>{s.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {trainingType === 'other' && (
                    <>
                      <Text style={styles.label}>Describe <Text style={styles.required}>*</Text></Text>
                      <TextInput style={[styles.input, { borderColor: themeColor + '60' }]} placeholder="e.g. CrossFit, martial arts..."
                        placeholderTextColor={colors.textMuted} value={trainingOther} onChangeText={setTrainingOther} />
                    </>
                  )}
                </>
              )}

              {category === 'errands' && (
                <>
                  <Text style={styles.label}>Type of errand <Text style={styles.required}>*</Text></Text>
                  <View style={styles.chipGrid}>
                    {ERRAND_TYPES.map((s) => (
                      <TouchableOpacity key={s.key}
                        style={[styles.chip, errandType === s.key && { backgroundColor: themeLightColor, borderColor: themeColor }]}
                        onPress={() => setErrandType(s.key)}>
                        <Text style={[styles.chipText, errandType === s.key && { color: themeColor, fontWeight: '700' }]}>{s.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {errandType === 'other' && (
                    <>
                      <Text style={styles.label}>Describe <Text style={styles.required}>*</Text></Text>
                      <TextInput style={[styles.input, { borderColor: themeColor + '60' }]} placeholder="e.g. Pick up dry cleaning..."
                        placeholderTextColor={colors.textMuted} value={errandOther} onChangeText={setErrandOther} />
                    </>
                  )}
                </>
              )}

              {/* Timing flexible toggle */}
              {(category === 'manual_labor' || category === 'professional' || category === 'cooking' || category === 'elder_care' || category === 'physical_training' || category === 'errands') && (
                <View style={[styles.switchRow, { backgroundColor: themeLightColor, borderColor: themeColor + '40' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.switchLabel, { color: themeColor }]}>⏰ Timing flexible</Text>
                    <Text style={styles.switchSub}>
                      {isOffering ? 'You can work around their schedule' : 'Open to scheduling around the helper'}
                    </Text>
                  </View>
                  <Switch
                    value={timingFlexible}
                    onValueChange={setTimingFlexible}
                    trackColor={{ false: colors.border, true: themeColor }}
                    thumbColor="#fff"
                  />
                </View>
              )}

              {/* Date / time / duration */}
              {(category === 'kid_sit' || (category === 'dog' && dogTask === 'boarding')) && isOvernight && !isOffering ? (
                <>
                  <Text style={styles.sectionHead}>Drop-off</Text>
                  <View style={styles.rowPickers}>
                    <TouchableOpacity style={[styles.pickerBtn, { borderColor: themeColor + '60', flex: 1 }]} onPress={() => setShowDropoffDate(true)}>
                      <Text style={styles.pickerIcon}>📅</Text>
                      <Text style={styles.pickerText}>{toDateDisplay(dropoffDate)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.pickerBtn, { borderColor: themeColor + '60', flex: 1 }]} onPress={() => setShowDropoffTime(true)}>
                      <Text style={styles.pickerIcon}>🕐</Text>
                      <Text style={styles.pickerText}>{toTimeDisplay(dropoffTime)}</Text>
                    </TouchableOpacity>
                  </View>
                  {showDropoffDate && <DateTimePicker value={dropoffDate} mode="date" minimumDate={new Date()} onChange={(_, s) => { setShowDropoffDate(false); if (s) setDropoffDate(s); }} />}
                  {showDropoffTime && <DateTimePicker value={dropoffTime} mode="time" onChange={(_, s) => { setShowDropoffTime(false); if (s) setDropoffTime(s); }} />}
                  <Text style={styles.sectionHead}>Pick-up</Text>
                  <View style={styles.rowPickers}>
                    <TouchableOpacity style={[styles.pickerBtn, { borderColor: themeColor + '60', flex: 1 }]} onPress={() => setShowPickupDate(true)}>
                      <Text style={styles.pickerIcon}>📅</Text>
                      <Text style={styles.pickerText}>{toDateDisplay(pickupDate)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.pickerBtn, { borderColor: themeColor + '60', flex: 1 }]} onPress={() => setShowPickupTime(true)}>
                      <Text style={styles.pickerIcon}>🕐</Text>
                      <Text style={styles.pickerText}>{toTimeDisplay(pickupTime)}</Text>
                    </TouchableOpacity>
                  </View>
                  {showPickupDate && <DateTimePicker value={pickupDate} mode="date" minimumDate={dropoffDate} onChange={(_, s) => { setShowPickupDate(false); if (s) setPickupDate(s); }} />}
                  {showPickupTime && <DateTimePicker value={pickupTime} mode="time" onChange={(_, s) => { setShowPickupTime(false); if (s) setPickupTime(s); }} />}
                  {overnight.actualHours > 0 && (
                    <View style={[styles.calcBox, { backgroundColor: themeLightColor }]}>
                      <Text style={styles.calcText}>
                        {overnight.actualHours}h actual  →  <Text style={{ color: themeColor, fontWeight: '800' }}>{overnight.charged}h charged</Text> (halved)
                      </Text>
                    </View>
                  )}
                </>
              ) : isOffering ? (
                <>
                  {/* Offering: availability date range */}
                  <Text style={styles.sectionHead}>When are you available?</Text>
                  <Text style={styles.label}>Available from <Text style={styles.required}>*</Text></Text>
                  <TouchableOpacity style={[styles.pickerBtn, { borderColor: themeColor + '60' }]} onPress={() => setShowDatePicker(true)}>
                    <Text style={styles.pickerIcon}>📅</Text>
                    <Text style={styles.pickerText}>{toDateDisplay(date)}</Text>
                  </TouchableOpacity>
                  {showDatePicker && <DateTimePicker value={date} mode="date" minimumDate={new Date()} onChange={(_, s) => { setShowDatePicker(false); if (s) setDate(s); }} />}

                  <View style={[styles.switchRow, { backgroundColor: themeLightColor, borderColor: themeColor + '40', marginTop: 10 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.switchLabel}>Open-ended</Text>
                      <Text style={styles.switchSub}>No specific end date</Text>
                    </View>
                    <Switch
                      value={availabilityOpenEnded}
                      onValueChange={setAvailabilityOpenEnded}
                      trackColor={{ false: colors.border, true: themeColor }}
                      thumbColor="#fff"
                    />
                  </View>

                  {!availabilityOpenEnded && (
                    <>
                      <Text style={styles.label}>Until</Text>
                      <TouchableOpacity style={[styles.pickerBtn, { borderColor: themeColor + '60' }]} onPress={() => setShowAvailabilityEndDatePicker(true)}>
                        <Text style={styles.pickerIcon}>📅</Text>
                        <Text style={styles.pickerText}>{toDateDisplay(availabilityEndDate)}</Text>
                      </TouchableOpacity>
                      {showAvailabilityEndDatePicker && (
                        <DateTimePicker value={availabilityEndDate} mode="date" minimumDate={date}
                          onChange={(_, s) => { setShowAvailabilityEndDatePicker(false); if (s) setAvailabilityEndDate(s); }} />
                      )}
                    </>
                  )}

                  <Text style={styles.label}>Time of day</Text>
                  <View style={styles.timePrefRow}>
                    {TIME_PREFS.map(tp => (
                      <TouchableOpacity
                        key={tp.key}
                        style={[styles.timePrefBtn, availabilityTimePref === tp.key && { backgroundColor: themeColor, borderColor: themeColor }]}
                        onPress={() => setAvailabilityTimePref(tp.key)}
                      >
                        <Text style={[styles.timePrefLabel, availabilityTimePref === tp.key && { color: '#fff' }]}>{tp.label}</Text>
                        <Text style={[styles.timePrefSub, availabilityTimePref === tp.key && { color: 'rgba(255,255,255,0.75)' }]}>{tp.sub}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.label}>Days available (optional)</Text>
                  <View style={styles.durationGrid}>
                    {DAYS_OF_WEEK.map(day => {
                      const selected = availabilityDays.includes(day);
                      return (
                        <TouchableOpacity key={day}
                          style={[styles.durationBtn, selected && { backgroundColor: themeColor, borderColor: themeColor }]}
                          onPress={() => setAvailabilityDays(prev => selected ? prev.filter(d => d !== day) : [...prev, day])}>
                          <Text style={[styles.durationText, selected && { color: '#fff' }]}>{day}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={[styles.flexNote, { color: themeColor }]}>Leave blank if any day works</Text>

                  <Text style={styles.label}>Max hours I can help</Text>
                  <View style={styles.durationGrid}>
                    {MAX_HOURS_OPTIONS.map((h) => (
                      <TouchableOpacity key={h}
                        style={[styles.durationBtn, maxHours === h && { backgroundColor: themeColor, borderColor: themeColor }]}
                        onPress={() => setMaxHours(h)}>
                        <Text style={[styles.durationText, maxHours === h && { color: '#fff' }]}>{h}h</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.label}>
                    {timingFlexible ? 'Preferred date' : 'Date'} <Text style={styles.required}>*</Text>
                  </Text>
                  <TouchableOpacity style={[styles.pickerBtn, { borderColor: themeColor + '60' }]} onPress={() => setShowDatePicker(true)}>
                    <Text style={styles.pickerIcon}>📅</Text>
                    <Text style={styles.pickerText}>{toDateDisplay(date)}</Text>
                  </TouchableOpacity>
                  {showDatePicker && <DateTimePicker value={date} mode="date" minimumDate={new Date()} onChange={(_, s) => { setShowDatePicker(false); if (s) setDate(s); }} />}
                  {timingFlexible && <Text style={[styles.flexNote, { color: themeColor }]}>Other households will know you're open to other times</Text>}
                  <Text style={styles.label}>
                    {timingFlexible ? 'Time of day' : 'Start time'} <Text style={styles.required}>*</Text>
                  </Text>
                  {timingFlexible ? (
                    <View style={styles.timePrefRow}>
                      {TIME_PREFS.map(tp => (
                        <TouchableOpacity
                          key={tp.key}
                          style={[styles.timePrefBtn, requestTimePref === tp.key && { backgroundColor: themeColor, borderColor: themeColor }]}
                          onPress={() => setRequestTimePref(tp.key)}
                        >
                          <Text style={[styles.timePrefLabel, requestTimePref === tp.key && { color: '#fff' }]}>{tp.label}</Text>
                          <Text style={[styles.timePrefSub, requestTimePref === tp.key && { color: 'rgba(255,255,255,0.75)' }]}>{tp.sub}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : (
                    <>
                      <TouchableOpacity style={[styles.pickerBtn, { borderColor: themeColor + '60' }]} onPress={() => setShowTimePicker(true)}>
                        <Text style={styles.pickerIcon}>🕐</Text>
                        <Text style={styles.pickerText}>{toTimeDisplay(startTime)}</Text>
                      </TouchableOpacity>
                      {showTimePicker && <DateTimePicker value={startTime} mode="time" onChange={(_, s) => { setShowTimePicker(false); if (s) setStartTime(s); }} />}
                    </>
                  )}
                  {timingFlexible && (
                    <>
                      <Text style={styles.label}>Days (optional)</Text>
                      <View style={styles.durationGrid}>
                        {DAYS_OF_WEEK.map(day => {
                          const selected = requestDays.includes(day);
                          return (
                            <TouchableOpacity key={day}
                              style={[styles.durationBtn, selected && { backgroundColor: themeColor, borderColor: themeColor }]}
                              onPress={() => setRequestDays(prev => selected ? prev.filter(d => d !== day) : [...prev, day])}>
                              <Text style={[styles.durationText, selected && { color: '#fff' }]}>{day}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      <Text style={[styles.flexNote, { color: themeColor }]}>Leave blank if any day works</Text>
                    </>
                  )}
                  <Text style={styles.label}>{category === 'manual_labor' ? 'Estimated hours' : 'Duration'}</Text>
                  <View style={styles.durationGrid}>
                    {DURATION_OPTIONS.map((h) => (
                      <TouchableOpacity key={h}
                        style={[styles.durationBtn, duration === h && { backgroundColor: themeColor, borderColor: themeColor }]}
                        onPress={() => setDuration(h)}>
                        <Text style={[styles.durationText, duration === h && { color: '#fff' }]}>
                          {h}h{category === 'manual_labor' ? ` = ${h * 2}h` : ''}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {category === 'manual_labor' && <Text style={styles.laborNote}>Real hours of work → hours charged (2×)</Text>}
                </>
              )}

              {/* Balance preview */}
              {isOffering ? (
                <View style={[styles.balancePreview, { borderColor: colors.green }]}>
                  <View>
                    <Text style={styles.balancePreviewLabel}>Max you can earn</Text>
                    <Text style={styles.balancePreviewSub}>Actual hours depend on the job</Text>
                  </View>
                  <Text style={[styles.balancePreviewValue, { color: colors.green }]}>+{maxHours}h</Text>
                </View>
              ) : (
                <View style={[styles.balancePreview, { borderColor: newBalance < 0 ? colors.red : colors.green }]}>
                  <View>
                    <Text style={styles.balancePreviewLabel}>Balance after this request</Text>
                    {category === 'manual_labor' && <Text style={styles.balancePreviewSub}>{duration}h work · {chargedHours}h charged (2× rate)</Text>}
                  </View>
                  <Text style={[styles.balancePreviewValue, { color: newBalance < 0 ? colors.red : colors.green }]}>
                    {newBalance > 0 ? '+' : ''}{newBalance}h
                  </Text>
                </View>
              )}

              {/* Notes */}
              <Text style={styles.label}>Notes (optional)</Text>
              <TextInput style={[styles.input, styles.textArea, { borderColor: themeColor + '40' }]}
                placeholder={
                  category === 'kid_sit'           ? 'Allergies, bedtime routine, parking info...'
                  : category === 'dog'             ? 'Feeding instructions, vet info, any quirks...'
                  : category === 'professional'    ? 'Any context, background, or specific questions...'
                  : category === 'cooking'         ? 'Dietary restrictions, kitchen access, what to bring...'
                  : category === 'elder_care'      ? 'Any health info, preferences, access details...'
                  : category === 'physical_training' ? 'Fitness level, goals, preferred location...'
                  : category === 'errands'           ? 'Address, specific brand/size needed, anything else...'
                  : 'Tools needed, access info, anything else...'
                }
                placeholderTextColor={colors.textMuted}
                value={notes} onChangeText={setNotes} multiline numberOfLines={3} />

              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: themeColor }]}
                onPress={handleSubmit} disabled={loading}>
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.submitText}>
                      {sendDirect && targetHousehold
                        ? `Send directly to ${targetHousehold.name} ${catConfig?.emoji ?? ''}`
                        : isOffering ? `Post Availability ${catConfig?.emoji ?? '🙋'}`
                        : `Post Request ${catConfig?.emoji ?? ''}`}
                    </Text>}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, marginBottom: 20 },
  back: { fontSize: 16, color: colors.primary, fontWeight: '600', width: 60 },
  screenTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  label: { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 7, marginTop: 14 },
  labelHint: { fontSize: 12, fontWeight: '400', color: colors.textMuted },
  required: { color: colors.red },
  sectionHead: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 16, marginBottom: 8 },

  // Post type toggle
  postTypeRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  postTypeBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card,
  },
  postTypeBtnActiveRequest: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  postTypeBtnActiveOffer:   { borderColor: colors.green,   backgroundColor: colors.greenLight },
  postTypeEmoji: { fontSize: 22, marginBottom: 4 },
  postTypeLabel: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  postTypeSubLabel: { fontSize: 11, fontWeight: '500', color: colors.textMuted, marginTop: 1 },
  postTypeLabelActiveRequest: { color: colors.primaryDark },
  postTypeLabelActiveOffer:   { color: '#059669' },

  // Category picker (expanded)
  categoryGrid: { gap: 8 },
  categoryCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderWidth: 1.5, borderRadius: 14, padding: 14, gap: 12,
  },
  categoryEmoji: { fontSize: 24 },
  categoryLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  categorySub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  categoryChevron: { fontSize: 22, color: colors.textMuted },

  // Category collapsed chip
  categorySelected: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, borderWidth: 1.5, padding: 14,
  },
  categorySelectedEmoji: { fontSize: 24 },
  categorySelectedLabel: { fontSize: 15, fontWeight: '800' },
  changeCategoryBtn: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  changeCategoryText: { fontSize: 13, fontWeight: '700' },

  // Direct request
  directRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, borderWidth: 1.5, padding: 14, marginTop: 14,
  },
  directLabel: { fontSize: 15, fontWeight: '700' },
  directSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  householdList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  householdChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 20, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.card, paddingHorizontal: 12, paddingVertical: 8,
  },
  householdChipAnimal: { fontSize: 20 },
  householdChipName: { fontSize: 14, fontWeight: '600', color: colors.text },

  // Segment buttons
  segmentRow: { flexDirection: 'row', gap: 10 },
  segmentBtn: { flex: 1, paddingVertical: 13, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center' },
  segmentText: { fontSize: 13, fontWeight: '600', color: '#374151' },

  // Switch rows
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: 14, padding: 16, marginTop: 16, borderWidth: 1.5 },
  switchLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  switchSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  // Rate badge
  rateBadge: { borderRadius: 12, padding: 12, marginTop: 10, borderWidth: 1 },
  rateText: { fontSize: 13, fontWeight: '600' },

  // Chips (service / cooking / etc)
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  chipText: { fontSize: 13, fontWeight: '600', color: '#374151' },

  // Inputs
  input: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: colors.text },
  textArea: { height: 95, textAlignVertical: 'top' },
  pickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13 },
  pickerIcon: { fontSize: 18 },
  pickerText: { fontSize: 15, color: colors.text, fontWeight: '500', flexShrink: 1 },
  rowPickers: { flexDirection: 'row', gap: 10 },
  durationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  durationBtn: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  durationText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  laborNote: { fontSize: 12, color: colors.textMuted, marginTop: 6, fontStyle: 'italic' },
  flexNote: { fontSize: 12, fontStyle: 'italic', marginTop: 6, marginBottom: 2 },
  calcBox: { borderRadius: 12, padding: 12, marginTop: 12, alignItems: 'center' },
  calcText: { fontSize: 15, color: colors.text },

  // Offering time preference
  timePrefRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  timePrefBtn: { width: '48%', paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center' },
  timePrefLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
  timePrefSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  // Balance preview
  balancePreview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, padding: 16, marginTop: 16, borderWidth: 1.5 },
  balancePreviewLabel: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  balancePreviewSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  balancePreviewValue: { fontSize: 22, fontWeight: '800' },

  submitBtn: { borderRadius: 16, paddingVertical: 17, alignItems: 'center', marginTop: 26, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
