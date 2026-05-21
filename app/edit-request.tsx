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

const CATEGORIES: { key: RequestCategory; emoji: string; label: string; sub: string }[] = [
  { key: 'kid_sit',      emoji: '👧', label: 'Kid-sitting',      sub: 'Watching kids at home' },
  { key: 'dog',          emoji: '🐾', label: 'Pet care',          sub: 'Walking, boarding, or checking in on pets' },
  { key: 'manual_labor', emoji: '🔨', label: 'Manual labor',      sub: 'Garden, painting, moving, etc. · 2× rate' },
  { key: 'professional', emoji: '🎓', label: 'Professional help', sub: 'Counseling, legal, tech, finance, and more' },
  { key: 'cooking',      emoji: '🍳', label: 'Cooking / baking',  sub: 'Meal prep, baking, recipe help, and more' },
];

const PROFESSIONAL_SERVICES = [
  { key: 'counseling', label: '💆 Counseling' },
  { key: 'legal',      label: '⚖️ Legal advice' },
  { key: 'computer',   label: '💻 Tech / computer help' },
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
  d.setHours(hours, m || 0, 0, 0);
  return d;
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

  // timing flexible
  const [timingFlexible, setTimingFlexible] = useState(false);

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
      if ((req.category ?? 'kid_sit') === 'kid_sit' && req.category_details) {
        const d = req.category_details as { location?: 'kids_house' | 'sitters_house' };
        setKidLocation(d.location ?? null);
      }

      if (req.category === 'dog' && req.category_details) {
        const d = req.category_details as { pet_name?: string; dog_name?: string; dog_task: 'walk' | 'boarding' | 'house_check' };
        setPetName(d.pet_name ?? d.dog_name ?? '');
        setDogTask(d.dog_task ?? 'boarding');
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

      if (req.is_overnight) {
        setDropoffDate(parseDateStr(req.date));
        setDropoffTime(parseTimeStr(req.start_time));
        if (req.end_date) setPickupDate(parseDateStr(req.end_date));
        if (req.end_time) setPickupTime(parseTimeStr(req.end_time));
      } else {
        setDate(parseDateStr(req.date));
        setStartTime(parseTimeStr(req.start_time));
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
    if (category === 'kid_sit' && isOvernight && overnight.actualHours <= 0) {
      return Alert.alert('Invalid times', 'Pickup must be after drop-off.');
    }

    const resolvedService = serviceType === 'other'
      ? serviceOther.trim()
      : PROFESSIONAL_SERVICES.find(s => s.key === serviceType)?.label ?? serviceType;

    const resolvedCooking = cookingType === 'other'
      ? cookingOther.trim()
      : COOKING_TYPES.find(s => s.key === cookingType)?.label ?? cookingType;

    const categoryDetails =
      category === 'kid_sit'      ? { location: kidLocation! }
      : category === 'dog'        ? { pet_name: petName.trim(), dog_task: dogTask }
      : category === 'manual_labor' ? { labor_description: laborDescription.trim(), actual_hours: duration, timing_flexible: timingFlexible || undefined }
      : category === 'professional' ? { service_type: resolvedService, timing_flexible: timingFlexible || undefined }
      : category === 'cooking'      ? { cooking_type: resolvedCooking, timing_flexible: timingFlexible || undefined }
      : null;

    setSaving(true);
    const { error } = await supabase.from('requests').update({
      category,
      category_details: categoryDetails,
      title: title.trim(),
      kid_name: category === 'kid_sit' ? (kidName.trim() || null) : null,
      date: ((category === 'kid_sit' || (category === 'dog' && dogTask === 'boarding')) && isOvernight) ? toDateOnly(dropoffDate) : toDateOnly(date),
      start_time: ((category === 'kid_sit' || (category === 'dog' && dogTask === 'boarding')) && isOvernight) ? toTimeDisplay(dropoffTime) : toTimeDisplay(startTime),
      end_date: ((category === 'kid_sit' || (category === 'dog' && dogTask === 'boarding')) && isOvernight) ? toDateOnly(pickupDate) : null,
      end_time: ((category === 'kid_sit' || (category === 'dog' && dogTask === 'boarding')) && isOvernight) ? toTimeDisplay(pickupTime) : null,
      duration_hours: chargedHours,
      is_overnight: (category === 'kid_sit' || (category === 'dog' && dogTask === 'boarding')) && isOvernight,
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

          {/* Timing flexible toggle (manual_labor, professional, cooking) */}
          {(category === 'manual_labor' || category === 'professional' || category === 'cooking') && (
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
              <Text style={styles.label}>
                {timingFlexible ? 'Preferred date' : 'Date'} <Text style={styles.required}>*</Text>
              </Text>
              <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowDatePicker(true)}>
                <Text style={styles.pickerIcon}>📅</Text>
                <Text style={styles.pickerText}>{toDateDisplay(date)}</Text>
              </TouchableOpacity>
              {showDatePicker && (
                <DateTimePicker value={date} mode="date" minimumDate={new Date()}
                  onChange={(_, s) => { setShowDatePicker(false); if (s) setDate(s); }} />
              )}
              {timingFlexible && <Text style={styles.flexibleNote}>Other families will know you're open to other times</Text>}
              <Text style={styles.label}>
                {timingFlexible ? 'Preferred time' : 'Start Time'} <Text style={styles.required}>*</Text>
              </Text>
              <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTimePicker(true)}>
                <Text style={styles.pickerIcon}>🕐</Text>
                <Text style={styles.pickerText}>{toTimeDisplay(startTime)}</Text>
              </TouchableOpacity>
              {showTimePicker && (
                <DateTimePicker value={startTime} mode="time"
                  onChange={(_, s) => { setShowTimePicker(false); if (s) setStartTime(s); }} />
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
