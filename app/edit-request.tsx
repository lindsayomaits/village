import { useState, useEffect } from 'react';
import {
  View, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert, Switch,
} from 'react-native';
import { Text } from '../components/Text';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import type { Request, RequestCategory } from '../types';

const DURATION_OPTIONS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
const TIME_PREFS = [
  { key: 'morning',   label: 'Morning',   sub: '8am–12pm' },
  { key: 'afternoon', label: 'Afternoon', sub: '12pm–5pm' },
  { key: 'evening',   label: 'Evening',   sub: '5pm–9pm' },
  { key: 'flexible',  label: 'Flexible',  sub: 'Any time works' },
] as const;
const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const CATEGORIES: { key: RequestCategory; emoji: string; label: string; sub: string }[] = [
  { key: 'kid_sit',           emoji: '👧', label: 'Kid-sitting',      sub: 'Watching kids at home' },
  { key: 'dog',               emoji: '🐾', label: 'Pet care',          sub: 'Walking, boarding, or checking in on pets' },
  { key: 'manual_labor',      emoji: '🔨', label: 'Manual labor',      sub: 'Garden, painting, moving, etc. · 2× rate' },
  { key: 'professional',      emoji: '🎓', label: 'Professional help', sub: 'Counseling, legal, tech, finance, and more' },
  { key: 'cooking',           emoji: '🍳', label: 'Cooking / baking',  sub: 'Meal prep, baking, recipe help, and more' },
  { key: 'elder_care',        emoji: '🤝', label: 'Elder care',        sub: 'Companionship, errands, or assistance' },
  { key: 'physical_training', emoji: '🏃', label: 'Physical training', sub: 'Running, yoga, weights, and more' },
  { key: 'errands',           emoji: '🛒', label: 'Errands',           sub: 'Groceries, transport, pick-ups, and more' },
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

function toDateOnly(d: Date) {
  return d.toISOString().split('T')[0];
}
function toTimeDisplay(d: Date) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function toDateDisplay(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function parseDateStr(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}
function parseTimeStr(timeStr: string): Date {
  const d = new Date();
  const upper = timeStr.toUpperCase();
  const isPM = upper.includes('PM');
  const isAM = upper.includes('AM');
  const clean = timeStr.replace(/[APM\s]/gi, '');
  const [h, m] = clean.split(':').map(Number);
  let hours = h;
  if (isPM && h !== 12) hours += 12;
  if (isAM && h === 12) hours = 0;
  // start_time is free text ("Morning · Mon, Tue") for a flexible-timing
  // request, not a real clock time — falls through here as NaN. Fall back
  // instead of handing an Invalid Date to the native time picker, which
  // crashes/hangs the edit screen.
  if (!Number.isFinite(hours)) { d.setHours(9, 0, 0, 0); return d; }
  d.setHours(hours, m || 0, 0, 0);
  return d;
}
// Reverses the "{TimePrefLabel} · {Day, Day}" format new-request.tsx
// writes for a flexible-timing start_time, back into a pref key + days.
function parseFlexibleTimeLabel(label: string): { pref: typeof TIME_PREFS[number]['key']; days: string[] } {
  const [prefLabel, daysPart] = label.split(' · ');
  const pref = TIME_PREFS.find(t => t.label === prefLabel)?.key ?? 'flexible';
  const days = daysPart ? daysPart.split(',').map(s => s.trim()).filter(Boolean) : [];
  return { pref, days };
}
function calcOvernightHours(dropoffDate: Date, dropoffTime: Date, pickupDate: Date, pickupTime: Date) {
  const dropoff = new Date(
    dropoffDate.getFullYear(), dropoffDate.getMonth(), dropoffDate.getDate(),
    dropoffTime.getHours(), dropoffTime.getMinutes()
  );
  const pickup = new Date(
    pickupDate.getFullYear(), pickupDate.getMonth(), pickupDate.getDate(),
    pickupTime.getHours(), pickupTime.getMinutes()
  );
  const actualHours = (pickup.getTime() - dropoff.getTime()) / 3600000;
  const charged = Math.round((actualHours / 2) * 2) / 2;
  return { actualHours: Math.round(actualHours * 10) / 10, charged: Math.max(0.5, charged) };
}

export default function EditRequestScreen() {
  const router = useRouter();
  const { requestId } = useLocalSearchParams<{ requestId: string }>();

  const [request, setRequest] = useState<Request | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [category, setCategory] = useState<RequestCategory>('kid_sit');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');

  // kid_sit
  const [kidName, setKidName] = useState('');
  const [isOvernight, setIsOvernight] = useState(false);
  const [kidLocation, setKidLocation] = useState<'kids_house' | 'sitters_house' | null>(null);

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

  // elder care
  const [elderCareType, setElderCareType] = useState('');
  const [elderCareOther, setElderCareOther] = useState('');

  // physical training
  const [trainingType, setTrainingType] = useState('');
  const [trainingOther, setTrainingOther] = useState('');

  // errands
  const [errandType, setErrandType] = useState('');
  const [errandOther, setErrandOther] = useState('');

  // timing flexible
  const [timingFlexible, setTimingFlexible] = useState(false);
  const [requestTimePref, setRequestTimePref] = useState<typeof TIME_PREFS[number]['key']>('flexible');
  const [requestDays, setRequestDays] = useState<string[]>([]);
  const [flexEndDate, setFlexEndDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 7); return d; });
  const [showFlexEndDatePicker, setShowFlexEndDatePicker] = useState(false);
  const [isUrgent, setIsUrgent] = useState(false);

  // Date / time / duration
  const [date, setDate] = useState(new Date());
  const [startTime, setStartTime] = useState(new Date());
  const [duration, setDuration] = useState<number>(2);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Overnight
  const [dropoffDate, setDropoffDate] = useState(new Date());
  const [dropoffTime, setDropoffTime] = useState(new Date());
  const [pickupDate, setPickupDate] = useState(new Date());
  const [pickupTime, setPickupTime] = useState(new Date());
  const [showDropoffDate, setShowDropoffDate] = useState(false);
  const [showDropoffTime, setShowDropoffTime] = useState(false);
  const [showPickupDate, setShowPickupDate] = useState(false);
  const [showPickupTime, setShowPickupTime] = useState(false);

  useEffect(() => {
    if (!requestId) return;
    supabase.from('requests').select('*').eq('id', requestId).single().then(({ data }) => {
      if (!data) { Alert.alert('Error', 'Request not found'); router.back(); return; }
      const req = data as Request;
      setRequest(req);
      setCategory(req.category ?? 'kid_sit');
      setTitle(req.title);
      setNotes(req.notes ?? '');
      setKidName(req.kid_name ?? '');
      setIsOvernight(req.is_overnight ?? false);
      setIsUrgent(req.is_urgent ?? false);
      if ((req.category ?? 'kid_sit') === 'kid_sit' && req.category_details) {
        const d = req.category_details as { location?: 'kids_house' | 'sitters_house'; timing_flexible?: boolean };
        setKidLocation(d.location ?? null);
        setTimingFlexible(d.timing_flexible ?? false);
      }

      if (req.category === 'dog' && req.category_details) {
        const d = req.category_details as { pet_name?: string; dog_name?: string; dog_task: 'walk' | 'boarding' | 'house_check'; timing_flexible?: boolean };
        setPetName(d.pet_name ?? d.dog_name ?? '');
        setDogTask(d.dog_task ?? 'boarding');
        setTimingFlexible(d.timing_flexible ?? false);
      }
      if (req.category === 'manual_labor' && req.category_details) {
        const d = req.category_details as { labor_description: string; actual_hours: number; timing_flexible?: boolean };
        setLaborDescription(d.labor_description ?? '');
        const actualHours = d.actual_hours ?? req.duration_hours / 2;
        const matched = DURATION_OPTIONS.find(h => h === actualHours);
        setDuration(matched ?? actualHours);
        setTimingFlexible(d.timing_flexible ?? false);
      }
      if (req.category === 'professional' && req.category_details) {
        const d = req.category_details as { service_type: string; timing_flexible?: boolean };
        const knownService = PROFESSIONAL_SERVICES.find(s => s.label === d.service_type);
        if (knownService) { setServiceType(knownService.key); }
        else { setServiceType('other'); setServiceOther(d.service_type ?? ''); }
        setTimingFlexible(d.timing_flexible ?? false);
      }
      if (req.category === 'cooking' && req.category_details) {
        const d = req.category_details as { cooking_type: string; timing_flexible?: boolean };
        const knownType = COOKING_TYPES.find(s => s.label === d.cooking_type);
        if (knownType) { setCookingType(knownType.key); }
        else { setCookingType('other'); setCookingOther(d.cooking_type ?? ''); }
        setTimingFlexible(d.timing_flexible ?? false);
      }
      if (req.category === 'elder_care' && req.category_details) {
        const d = req.category_details as { elder_care_type: string; timing_flexible?: boolean };
        const knownType = ELDER_CARE_TYPES.find(s => s.label === d.elder_care_type);
        if (knownType) { setElderCareType(knownType.key); }
        else { setElderCareType('other'); setElderCareOther(d.elder_care_type ?? ''); }
        setTimingFlexible(d.timing_flexible ?? false);
      }
      if (req.category === 'physical_training' && req.category_details) {
        const d = req.category_details as { training_type: string; timing_flexible?: boolean };
        const knownType = TRAINING_TYPES.find(s => s.label === d.training_type);
        if (knownType) { setTrainingType(knownType.key); }
        else { setTrainingType('other'); setTrainingOther(d.training_type ?? ''); }
        setTimingFlexible(d.timing_flexible ?? false);
      }
      if (req.category === 'errands' && req.category_details) {
        const d = req.category_details as { errand_type: string; timing_flexible?: boolean };
        const knownType = ERRAND_TYPES.find(s => s.label === d.errand_type);
        if (knownType) { setErrandType(knownType.key); }
        else { setErrandType('other'); setErrandOther(d.errand_type ?? ''); }
        setTimingFlexible(d.timing_flexible ?? false);
      }

      if (req.is_overnight) {
        setDropoffDate(parseDateStr(req.date));
        setDropoffTime(parseTimeStr(req.start_time));
        if (req.end_date) setPickupDate(parseDateStr(req.end_date));
        if (req.end_time) setPickupTime(parseTimeStr(req.end_time));
      } else {
        setDate(parseDateStr(req.date));
        // start_time is a free-text label ("Morning · Mon, Tue"), not a
        // clock time, when this request was posted with flexible timing —
        // read timing_flexible straight off category_details rather than
        // the timingFlexible state var, since that setter above hasn't
        // flushed yet within this same effect.
        const isFlexible = !!(req.category_details as { timing_flexible?: boolean } | null)?.timing_flexible;
        if (isFlexible) {
          const { pref, days } = parseFlexibleTimeLabel(req.start_time);
          setRequestTimePref(pref);
          setRequestDays(days);
          if (req.end_date) setFlexEndDate(parseDateStr(req.end_date));
        } else {
          setStartTime(parseTimeStr(req.start_time));
        }
        const cat = req.category ?? 'kid_sit';
        const rawHours = cat === 'manual_labor' ? req.duration_hours / 2 : req.duration_hours;
        const matched = DURATION_OPTIONS.find(h => h === rawHours);
        setDuration(matched ?? rawHours);
      }

      setLoading(false);
    });
  }, [requestId]);

  const overnight = calcOvernightHours(dropoffDate, dropoffTime, pickupDate, pickupTime);
  const baseDuration = ((category === 'kid_sit' || (category === 'dog' && dogTask === 'boarding')) && isOvernight) ? overnight.charged : duration;
  const chargedHours = category === 'manual_labor' ? baseDuration * 2 : baseDuration;

  function handleCategoryChange(next: RequestCategory) {
    setCategory(next);
    if (next !== 'kid_sit' && next !== 'dog') setIsOvernight(false);
  }

  async function handleSave() {
    if (!title.trim()) return Alert.alert('Please add a title');
    if (category === 'kid_sit' && !kidLocation) return Alert.alert('Please select a location');
    if (category === 'dog' && !petName.trim()) return Alert.alert("Please enter your pet's name");
    if (category === 'manual_labor' && !laborDescription.trim()) return Alert.alert('Please describe the task');
    if (category === 'professional' && !serviceType) return Alert.alert('Please select a service type');
    if (category === 'professional' && serviceType === 'other' && !serviceOther.trim()) return Alert.alert('Please describe the service');
    if (category === 'cooking' && !cookingType) return Alert.alert('Please select a cooking type');
    if (category === 'cooking' && cookingType === 'other' && !cookingOther.trim()) return Alert.alert('Please describe the cooking help');
    if (category === 'elder_care' && !elderCareType) return Alert.alert('Please select an elder care type');
    if (category === 'elder_care' && elderCareType === 'other' && !elderCareOther.trim()) return Alert.alert('Please describe the elder care help');
    if (category === 'physical_training' && !trainingType) return Alert.alert('Please select a training type');
    if (category === 'physical_training' && trainingType === 'other' && !trainingOther.trim()) return Alert.alert('Please describe the training');
    if (category === 'errands' && !errandType) return Alert.alert('Please select an errand type');
    if (category === 'errands' && errandType === 'other' && !errandOther.trim()) return Alert.alert('Please describe the errand');
    if (category === 'kid_sit' && isOvernight && overnight.actualHours <= 0) {
      return Alert.alert('Invalid times', 'Pickup must be after drop-off.');
    }
    if (timingFlexible && flexEndDate < date) {
      return Alert.alert('Invalid window', '"To" date must be on or after the "From" date.');
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
      category === 'kid_sit'      ? { location: kidLocation!, timing_flexible: (timingFlexible && !isOvernight) || undefined }
      : category === 'dog'        ? { pet_name: petName.trim(), dog_task: dogTask, timing_flexible: (timingFlexible && !isOvernight) || undefined }
      : category === 'manual_labor' ? { labor_description: laborDescription.trim(), actual_hours: duration, timing_flexible: timingFlexible || undefined }
      : category === 'professional' ? { service_type: resolvedService, timing_flexible: timingFlexible || undefined }
      : category === 'cooking'      ? { cooking_type: resolvedCooking, timing_flexible: timingFlexible || undefined }
      : category === 'elder_care'      ? { elder_care_type: resolvedElderCare, timing_flexible: timingFlexible || undefined }
      : category === 'physical_training' ? { training_type: resolvedTraining, timing_flexible: timingFlexible || undefined }
      : category === 'errands'         ? { errand_type: resolvedErrand, timing_flexible: timingFlexible || undefined }
      : null;

    const isFixedDateCategory = (category === 'kid_sit' || (category === 'dog' && dogTask === 'boarding')) && isOvernight;
    const flexTimePrefBase = TIME_PREFS.find(t => t.key === requestTimePref)?.label ?? 'Flexible';
    const flexStartTime = requestDays.length > 0 ? `${flexTimePrefBase} · ${requestDays.join(', ')}` : flexTimePrefBase;

    setSaving(true);
    const { error } = await supabase.from('requests').update({
      category,
      category_details: categoryDetails,
      title: title.trim(),
      kid_name: category === 'kid_sit' ? (kidName.trim() || null) : null,
      date: isFixedDateCategory ? toDateOnly(dropoffDate) : toDateOnly(date),
      start_time: isFixedDateCategory ? toTimeDisplay(dropoffTime) : timingFlexible ? flexStartTime : toTimeDisplay(startTime),
      end_date: isFixedDateCategory ? toDateOnly(pickupDate) : timingFlexible ? toDateOnly(flexEndDate) : null,
      end_time: isFixedDateCategory ? toTimeDisplay(pickupTime) : null,
      duration_hours: chargedHours,
      is_overnight: isFixedDateCategory,
      is_urgent: isUrgent,
      notes: notes.trim() || null,
    }).eq('id', requestId);

    setSaving(false);
    if (error) return Alert.alert('Error', error.message);
    router.back();
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  const catConfig = CATEGORIES.find(c => c.key === category)!;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.topRow}>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.back}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.screenTitle}>Edit Request</Text>
            <View style={{ width: 60 }} />
          </View>

          {/* Category picker */}
          <Text style={styles.label}>Category</Text>
          <View style={styles.categoryGrid}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c.key}
                style={[styles.categoryCard, category === c.key && styles.categoryCardActive]}
                onPress={() => handleCategoryChange(c.key)}
              >
                <Text style={styles.categoryEmoji}>{c.emoji}</Text>
                <Text style={[styles.categoryLabel, category === c.key && styles.categoryLabelActive]}>{c.label}</Text>
                <Text style={[styles.categorySub, category === c.key && styles.categorySubActive]}>{c.sub}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Title <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={styles.input}
            placeholder={
              category === 'kid_sit' ? 'e.g. Friday evening'
              : category === 'dog' ? 'e.g. Saturday morning walk'
              : 'e.g. Help painting the back fence'
            }
            placeholderTextColor={colors.textMuted}
            value={title}
            onChangeText={setTitle}
          />

          {/* Kid-sit specific */}
          {category === 'kid_sit' && (
            <>
              <Text style={styles.label}>Kid(s)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Mia, or Mia & Jake"
                placeholderTextColor={colors.textMuted}
                value={kidName}
                onChangeText={setKidName}
              />
              <Text style={styles.label}>Location <Text style={styles.required}>*</Text></Text>
              <View style={styles.segmentRow}>
                {([
                  { key: 'kids_house',    label: "🏠 At the kid's house" },
                  { key: 'sitters_house', label: "🏡 At the sitter's house" },
                ] as const).map(opt => (
                  <TouchableOpacity key={opt.key}
                    style={[styles.segmentBtn, kidLocation === opt.key && styles.segmentBtnActive]}
                    onPress={() => setKidLocation(opt.key)}>
                    <Text style={[styles.segmentText, kidLocation === opt.key && styles.segmentTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.overnightRow}>
                <View>
                  <Text style={styles.overnightLabel}>🌙 Overnight stay</Text>
                  <Text style={styles.overnightSub}>Hours charged at half rate</Text>
                </View>
                <Switch
                  value={isOvernight}
                  onValueChange={setIsOvernight}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>
            </>
          )}

          {/* Pet care specific */}
          {category === 'dog' && (
            <>
              <Text style={styles.label}>Pet's name <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Biscuit"
                placeholderTextColor={colors.textMuted}
                value={petName}
                onChangeText={setPetName}
              />
              <Text style={styles.label}>Type of care</Text>
              <View style={styles.segmentRow}>
                {([
                  { key: 'boarding',    label: '🏡 Boarding' },
                  { key: 'walk',        label: '🦮 Walking' },
                  { key: 'house_check', label: '🏠 House check' },
                ] as const).map(t => (
                  <TouchableOpacity key={t.key}
                    style={[styles.segmentBtn, dogTask === t.key && styles.segmentBtnActive]}
                    onPress={() => { setDogTask(t.key); if (t.key !== 'boarding') setIsOvernight(false); }}>
                    <Text style={[styles.segmentText, dogTask === t.key && styles.segmentTextActive]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {dogTask === 'boarding' && (
                <View style={styles.overnightRow}>
                  <View>
                    <Text style={styles.overnightLabel}>🌙 Overnight stay</Text>
                    <Text style={styles.overnightSub}>Hours charged at half rate</Text>
                  </View>
                  <Switch
                    value={isOvernight}
                    onValueChange={setIsOvernight}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>
              )}
            </>
          )}

          {/* Manual labor specific */}
          {category === 'manual_labor' && (
            <>
              <Text style={styles.label}>What needs doing? <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="e.g. Help planting the vegetable garden..."
                placeholderTextColor={colors.textMuted}
                value={laborDescription}
                onChangeText={setLaborDescription}
                multiline
                numberOfLines={3}
              />
              <View style={styles.laborRateBadge}>
                <Text style={styles.laborRateText}>🔨 Labor requests cost 2× hours — helpers earn double too</Text>
              </View>
            </>
          )}

          {/* Professional specific */}
          {category === 'professional' && (
            <>
              <Text style={styles.label}>Type of help <Text style={styles.required}>*</Text></Text>
              <View style={styles.serviceGrid}>
                {PROFESSIONAL_SERVICES.map((s) => (
                  <TouchableOpacity key={s.key}
                    style={[styles.serviceChip, serviceType === s.key && styles.serviceChipActiveSage]}
                    onPress={() => setServiceType(s.key)}>
                    <Text style={[styles.serviceChipText, serviceType === s.key && styles.serviceChipTextSage]}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {serviceType === 'other' && (
                <>
                  <Text style={styles.label}>Describe <Text style={styles.required}>*</Text></Text>
                  <TextInput style={styles.input} placeholder="e.g. Resume writing, photography tips..."
                    placeholderTextColor={colors.textMuted} value={serviceOther} onChangeText={setServiceOther} />
                </>
              )}
            </>
          )}

          {/* Cooking specific */}
          {category === 'cooking' && (
            <>
              <Text style={styles.label}>Type of help <Text style={styles.required}>*</Text></Text>
              <View style={styles.serviceGrid}>
                {COOKING_TYPES.map((s) => (
                  <TouchableOpacity key={s.key}
                    style={[styles.serviceChip, cookingType === s.key && styles.serviceChipActivePurple]}
                    onPress={() => setCookingType(s.key)}>
                    <Text style={[styles.serviceChipText, cookingType === s.key && styles.serviceChipTextPurple]}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {cookingType === 'other' && (
                <>
                  <Text style={styles.label}>Describe <Text style={styles.required}>*</Text></Text>
                  <TextInput style={styles.input} placeholder="e.g. Freezer meal prep, teaching sourdough..."
                    placeholderTextColor={colors.textMuted} value={cookingOther} onChangeText={setCookingOther} />
                </>
              )}
            </>
          )}

          {/* Elder care specific */}
          {category === 'elder_care' && (
            <>
              <Text style={styles.label}>Type of help <Text style={styles.required}>*</Text></Text>
              <View style={styles.serviceGrid}>
                {ELDER_CARE_TYPES.map((s) => (
                  <TouchableOpacity key={s.key}
                    style={[styles.serviceChip, elderCareType === s.key && styles.serviceChipActiveSage]}
                    onPress={() => setElderCareType(s.key)}>
                    <Text style={[styles.serviceChipText, elderCareType === s.key && styles.serviceChipTextSage]}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {elderCareType === 'other' && (
                <>
                  <Text style={styles.label}>Describe <Text style={styles.required}>*</Text></Text>
                  <TextInput style={styles.input} placeholder="e.g. Weekly check-in visits..."
                    placeholderTextColor={colors.textMuted} value={elderCareOther} onChangeText={setElderCareOther} />
                </>
              )}
            </>
          )}

          {/* Physical training specific */}
          {category === 'physical_training' && (
            <>
              <Text style={styles.label}>Type of training <Text style={styles.required}>*</Text></Text>
              <View style={styles.serviceGrid}>
                {TRAINING_TYPES.map((s) => (
                  <TouchableOpacity key={s.key}
                    style={[styles.serviceChip, trainingType === s.key && styles.serviceChipActiveSage]}
                    onPress={() => setTrainingType(s.key)}>
                    <Text style={[styles.serviceChipText, trainingType === s.key && styles.serviceChipTextSage]}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {trainingType === 'other' && (
                <>
                  <Text style={styles.label}>Describe <Text style={styles.required}>*</Text></Text>
                  <TextInput style={styles.input} placeholder="e.g. HIIT circuit training..."
                    placeholderTextColor={colors.textMuted} value={trainingOther} onChangeText={setTrainingOther} />
                </>
              )}
            </>
          )}

          {/* Errands specific */}
          {category === 'errands' && (
            <>
              <Text style={styles.label}>Type of errand <Text style={styles.required}>*</Text></Text>
              <View style={styles.serviceGrid}>
                {ERRAND_TYPES.map((s) => (
                  <TouchableOpacity key={s.key}
                    style={[styles.serviceChip, errandType === s.key && styles.serviceChipActiveSage]}
                    onPress={() => setErrandType(s.key)}>
                    <Text style={[styles.serviceChipText, errandType === s.key && styles.serviceChipTextSage]}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {errandType === 'other' && (
                <>
                  <Text style={styles.label}>Describe <Text style={styles.required}>*</Text></Text>
                  <TextInput style={styles.input} placeholder="e.g. Return a package at UPS..."
                    placeholderTextColor={colors.textMuted} value={errandOther} onChangeText={setErrandOther} />
                </>
              )}
            </>
          )}

          {/* Timing flexible toggle — for kid-sitting/pet care this only
              applies outside overnight mode, which already has its own
              fixed drop-off/pick-up window. */}
          {(category === 'manual_labor' || category === 'professional' || category === 'cooking' || category === 'elder_care' || category === 'physical_training' || category === 'errands'
            || ((category === 'kid_sit' || category === 'dog') && !isOvernight)) && (
            <View style={styles.flexibleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.flexibleLabel}>⏰ Timing flexible</Text>
                <Text style={styles.flexibleSub}>Open to scheduling around the helper</Text>
              </View>
              <Switch
                value={timingFlexible}
                onValueChange={setTimingFlexible}
                trackColor={{ false: colors.border, true: colors.sage }}
                thumbColor="#fff"
              />
            </View>
          )}

          {/* Urgent toggle */}
          <View style={[styles.flexibleRow, { backgroundColor: colors.redLight, borderColor: colors.red + '40' }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.flexibleLabel, { color: colors.red }]}>❗️ Mark as urgent</Text>
              <Text style={styles.flexibleSub}>For time-sensitive needs — stands out and sorts to the top</Text>
            </View>
            <Switch
              value={isUrgent}
              onValueChange={setIsUrgent}
              trackColor={{ false: colors.border, true: colors.red }}
              thumbColor="#fff"
            />
          </View>

          {/* Date / time / duration */}
          {(category === 'kid_sit' || (category === 'dog' && dogTask === 'boarding')) && isOvernight ? (
            <>
              <Text style={styles.sectionHead}>Drop-off</Text>
              <View style={styles.rowPickers}>
                <TouchableOpacity style={[styles.pickerBtn, { flex: 1 }]} onPress={() => setShowDropoffDate(true)}>
                  <Text style={styles.pickerIcon}>📅</Text>
                  <Text style={styles.pickerText}>{toDateDisplay(dropoffDate)}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.pickerBtn, { flex: 1 }]} onPress={() => setShowDropoffTime(true)}>
                  <Text style={styles.pickerIcon}>🕐</Text>
                  <Text style={styles.pickerText}>{toTimeDisplay(dropoffTime)}</Text>
                </TouchableOpacity>
              </View>
              {showDropoffDate && (
                <DateTimePicker value={dropoffDate} mode="date" minimumDate={new Date()}
                  onChange={(_, s) => { setShowDropoffDate(false); if (s) setDropoffDate(s); }} />
              )}
              {showDropoffTime && (
                <DateTimePicker value={dropoffTime} mode="time"
                  onChange={(_, s) => { setShowDropoffTime(false); if (s) setDropoffTime(s); }} />
              )}
              <Text style={styles.sectionHead}>Pick-up</Text>
              <View style={styles.rowPickers}>
                <TouchableOpacity style={[styles.pickerBtn, { flex: 1 }]} onPress={() => setShowPickupDate(true)}>
                  <Text style={styles.pickerIcon}>📅</Text>
                  <Text style={styles.pickerText}>{toDateDisplay(pickupDate)}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.pickerBtn, { flex: 1 }]} onPress={() => setShowPickupTime(true)}>
                  <Text style={styles.pickerIcon}>🕐</Text>
                  <Text style={styles.pickerText}>{toTimeDisplay(pickupTime)}</Text>
                </TouchableOpacity>
              </View>
              {showPickupDate && (
                <DateTimePicker value={pickupDate} mode="date" minimumDate={dropoffDate}
                  onChange={(_, s) => { setShowPickupDate(false); if (s) setPickupDate(s); }} />
              )}
              {showPickupTime && (
                <DateTimePicker value={pickupTime} mode="time"
                  onChange={(_, s) => { setShowPickupTime(false); if (s) setPickupTime(s); }} />
              )}
              {overnight.actualHours > 0 && (
                <View style={styles.overnightCalc}>
                  <Text style={styles.overnightCalcText}>
                    {overnight.actualHours}h actual  →  <Text style={{ color: colors.primary, fontWeight: '800' }}>{overnight.charged}h charged</Text> (halved)
                  </Text>
                </View>
              )}
            </>
          ) : (
            <>
              {timingFlexible ? (
                <>
                  <Text style={styles.label}>Window <Text style={styles.required}>*</Text></Text>
                  <View style={styles.rowPickers}>
                    <TouchableOpacity style={[styles.pickerBtn, { flex: 1 }]} onPress={() => setShowDatePicker(true)}>
                      <Text style={styles.pickerIcon}>📅</Text>
                      <Text style={styles.pickerText}>{toDateDisplay(date)}</Text>
                    </TouchableOpacity>
                    <Text style={styles.windowToText}>to</Text>
                    <TouchableOpacity style={[styles.pickerBtn, { flex: 1 }]} onPress={() => setShowFlexEndDatePicker(true)}>
                      <Text style={styles.pickerIcon}>📅</Text>
                      <Text style={styles.pickerText}>{toDateDisplay(flexEndDate)}</Text>
                    </TouchableOpacity>
                  </View>
                  {showDatePicker && (
                    <DateTimePicker value={date} mode="date" minimumDate={new Date()}
                      onChange={(_, s) => {
                        setShowDatePicker(false);
                        if (!s) return;
                        setDate(s);
                        // Keep the window valid — pushing "From" past the
                        // current "To" would otherwise leave an invalid
                        // end-before-start window sitting there silently.
                        if (s > flexEndDate) setFlexEndDate(s);
                      }} />
                  )}
                  {showFlexEndDatePicker && (
                    <DateTimePicker value={flexEndDate} mode="date" minimumDate={date}
                      onChange={(_, s) => { setShowFlexEndDatePicker(false); if (s) setFlexEndDate(s); }} />
                  )}
                  <Text style={styles.flexibleNote}>Other families will know you're open to any time in this window</Text>
                </>
              ) : (
                <>
                  <Text style={styles.label}>Date <Text style={styles.required}>*</Text></Text>
                  <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowDatePicker(true)}>
                    <Text style={styles.pickerIcon}>📅</Text>
                    <Text style={styles.pickerText}>{toDateDisplay(date)}</Text>
                  </TouchableOpacity>
                  {showDatePicker && (
                    <DateTimePicker value={date} mode="date" minimumDate={new Date()}
                      onChange={(_, s) => { setShowDatePicker(false); if (s) setDate(s); }} />
                  )}
                </>
              )}
              <Text style={styles.label}>
                {timingFlexible ? 'Time of day' : 'Start Time'} <Text style={styles.required}>*</Text>
              </Text>
              {timingFlexible ? (
                <View style={styles.durationGrid}>
                  {TIME_PREFS.map(tp => (
                    <TouchableOpacity
                      key={tp.key}
                      style={[styles.durationBtn, requestTimePref === tp.key && styles.durationBtnActive]}
                      onPress={() => setRequestTimePref(tp.key)}
                    >
                      <Text style={[styles.durationText, requestTimePref === tp.key && styles.durationTextActive]}>{tp.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <>
                  <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTimePicker(true)}>
                    <Text style={styles.pickerIcon}>🕐</Text>
                    <Text style={styles.pickerText}>{toTimeDisplay(startTime)}</Text>
                  </TouchableOpacity>
                  {showTimePicker && (
                    <DateTimePicker value={startTime} mode="time"
                      onChange={(_, s) => { setShowTimePicker(false); if (s) setStartTime(s); }} />
                  )}
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
                          style={[styles.durationBtn, selected && styles.durationBtnActive]}
                          onPress={() => setRequestDays(prev => selected ? prev.filter(d => d !== day) : [...prev, day])}>
                          <Text style={[styles.durationText, selected && styles.durationTextActive]}>{day}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={styles.flexibleNote}>Leave blank if any day works</Text>
                </>
              )}
              <Text style={styles.label}>{category === 'manual_labor' ? 'Estimated hours' : 'Duration'}</Text>
              <View style={styles.durationGrid}>
                {DURATION_OPTIONS.map((h) => (
                  <TouchableOpacity
                    key={h}
                    style={[styles.durationBtn, duration === h && styles.durationBtnActive]}
                    onPress={() => setDuration(h)}
                  >
                    <Text style={[styles.durationText, duration === h && styles.durationTextActive]}>
                      {h}h{category === 'manual_labor' ? ` = ${h * 2}h` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {category === 'manual_labor' && (
                <Text style={styles.laborDurationNote}>Real hours of work → hours charged (2×)</Text>
              )}
            </>
          )}

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder={
              category === 'kid_sit' ? 'Allergies, bedtime routine, parking info...'
              : category === 'dog' ? 'Feeding instructions, vet info, any quirks...'
              : category === 'professional' ? 'Any context, background, or specific questions...'
              : 'Tools needed, access info, anything else...'
            }
            placeholderTextColor={colors.textMuted}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
          />

          <TouchableOpacity style={styles.submitBtn} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Save Changes</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, marginBottom: 24 },
  back: { fontSize: 16, color: colors.primary, fontWeight: '600', width: 60 },
  screenTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  label: { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 7, marginTop: 14 },
  required: { color: colors.red },
  sectionHead: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 16, marginBottom: 8 },
  categoryGrid: { gap: 8 },
  categoryCard: {
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 14, padding: 14,
  },
  categoryCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  categoryEmoji: { fontSize: 22, marginBottom: 4 },
  categoryLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  categoryLabelActive: { color: colors.primaryDark },
  categorySub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  categorySubActive: { color: colors.primaryDark },
  segmentRow: { flexDirection: 'row', gap: 10 },
  segmentBtn: {
    flex: 1, paddingVertical: 13, paddingHorizontal: 10, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card,
    alignItems: 'center',
  },
  segmentBtnActive: { backgroundColor: colors.blueLight, borderColor: colors.blue },
  segmentText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  segmentTextActive: { color: colors.blue },
  laborRateBadge: {
    backgroundColor: colors.amberLight, borderRadius: 12, padding: 12,
    marginTop: 10, borderWidth: 1, borderColor: colors.amber + '40',
  },
  laborRateText: { fontSize: 13, color: colors.amber, fontWeight: '600' },
  laborDurationNote: { fontSize: 12, color: colors.textMuted, marginTop: 6, fontStyle: 'italic' },
  serviceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  serviceChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  serviceChipText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  serviceChipActiveSage: { backgroundColor: colors.sageLight, borderColor: colors.sage },
  serviceChipTextSage: { color: colors.sageDark },
  serviceChipActivePurple: { backgroundColor: colors.purpleLight, borderColor: colors.purple },
  serviceChipTextPurple: { color: colors.purple },
  input: {
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 16, color: colors.text,
  },
  textArea: { height: 95, textAlignVertical: 'top' },
  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13,
  },
  pickerIcon: { fontSize: 18 },
  pickerText: { fontSize: 15, color: colors.text, fontWeight: '500', flexShrink: 1 },
  rowPickers: { flexDirection: 'row', gap: 10 },
  durationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  durationBtn: {
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card,
  },
  durationBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  durationText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  durationTextActive: { color: '#fff' },
  overnightRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: 14, padding: 16,
    marginTop: 16, borderWidth: 1.5, borderColor: colors.border,
  },
  overnightLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  overnightSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  flexibleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.sageLight, borderRadius: 14, padding: 16, marginTop: 14, borderWidth: 1.5, borderColor: colors.sage + '60' },
  flexibleLabel: { fontSize: 15, fontWeight: '700', color: colors.sageDark },
  flexibleSub: { fontSize: 12, color: colors.sage, marginTop: 2 },
  flexibleNote: { fontSize: 12, color: colors.sage, fontStyle: 'italic', marginTop: 6, marginBottom: 2 },
  windowToText: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  overnightCalc: {
    backgroundColor: colors.primaryLight, borderRadius: 12, padding: 12,
    marginTop: 12, alignItems: 'center',
  },
  overnightCalcText: { fontSize: 15, color: colors.text },
  submitBtn: {
    backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 17,
    alignItems: 'center', marginTop: 26,
    shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
