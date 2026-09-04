import * as Calendar from 'expo-calendar';
import type * as NotificationsType from 'expo-notifications';
import { Platform, Alert } from 'react-native';
import { combineDateAndTime } from './utils';
import type { Request } from '../types';

// Merely importing 'expo-notifications' throws in Expo Go (SDK 53+ dropped
// remote push there), so it's required lazily rather than at module load.
function getNotifications() {
  return require('expo-notifications') as typeof NotificationsType;
}

function eventWindow(req: Request): { start: Date; end: Date } {
  const start = combineDateAndTime(req.date, req.start_time);
  let end: Date;
  if (req.end_date && req.end_time) {
    end = combineDateAndTime(req.end_date, req.end_time);
  } else {
    end = new Date(start.getTime() + req.duration_hours * 3600000);
  }
  if (end <= start) end = new Date(start.getTime() + 3600000);
  return { start, end };
}

export async function addRequestToCalendar(req: Request, otherName: string) {
  if (Platform.OS === 'web') {
    Alert.alert('Calendar unavailable on web', 'This feature is only available on mobile devices.');
    return;
  }

  try {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Calendar access needed', 'Enable calendar access in Settings to add this.');
      return;
    }

    let calendarId: string | undefined;
    if (Platform.OS === 'ios') {
      const defaultCal = await Calendar.getDefaultCalendarAsync();
      calendarId = defaultCal.id;
    } else {
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const writable = calendars.find(c => c.accessLevel === Calendar.CalendarAccessLevel.OWNER) ?? calendars[0];
      calendarId = writable?.id;
    }
    if (!calendarId) {
      Alert.alert('No calendar found', "Couldn't find a calendar to add this to.");
      return;
    }

    const { start, end } = eventWindow(req);
    await Calendar.createEventAsync(calendarId, {
      title: req.title,
      startDate: start,
      endDate: end,
      notes: `With ${otherName} — via VillageMates`,
    });
    Alert.alert('Added! 📅', `"${req.title}" is on your calendar.`);
  } catch {
    // expo-calendar isn't available in Expo Go (Expo dropped it there) —
    // this only works in a custom dev build, so surface that instead of
    // a native module crash.
    Alert.alert(
      'Calendar unavailable',
      'Adding to your calendar only works in the full app build, not the Expo Go preview.'
    );
  }
}

export type ReminderOffset = 'hour' | 'morning' | 'day' | 'week';

export const REMINDER_OPTIONS: { key: ReminderOffset; label: string }[] = [
  { key: 'hour', label: '1 hour before' },
  { key: 'morning', label: 'The morning of' },
  { key: 'day', label: 'The day before' },
  { key: 'week', label: 'One week before' },
];

function reminderFireDate(start: Date, when: ReminderOffset): { fireDate: Date; label: string } {
  switch (when) {
    case 'morning': {
      const fireDate = new Date(start);
      fireDate.setHours(8, 0, 0, 0);
      if (fireDate >= start) return { fireDate: new Date(start.getTime() - 3600000), label: 'this morning' };
      return { fireDate, label: 'this morning' };
    }
    case 'hour':
      return { fireDate: new Date(start.getTime() - 3600000), label: 'in an hour' };
    case 'day':
      return { fireDate: new Date(start.getTime() - 24 * 3600000), label: 'tomorrow' };
    case 'week':
      return { fireDate: new Date(start.getTime() - 7 * 24 * 3600000), label: 'in a week' };
  }
}

// Schedules one notification per selected offset. Offsets whose fire time
// has already passed are silently skipped (rather than failing the whole
// batch) since e.g. "one week before" is a no-op for a sit that's tomorrow.
export async function scheduleReminders(req: Request, whens: ReminderOffset[]): Promise<void> {
  if (Platform.OS === 'web') {
    Alert.alert('Reminder unavailable on web', 'Notifications are only available on the mobile app.');
    return;
  }
  if (whens.length === 0) return;

  const Notifications = getNotifications();

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    const { status: requested } = await Notifications.requestPermissionsAsync();
    status = requested;
  }
  if (status !== 'granted') {
    Alert.alert('Notifications disabled', 'Enable notifications in Settings to get a reminder.');
    return;
  }

  const { start } = eventWindow(req);
  const now = new Date();
  const scheduled: string[] = [];
  const skipped: string[] = [];

  for (const when of whens) {
    const { fireDate, label } = reminderFireDate(start, when);
    if (fireDate <= now) {
      skipped.push(label);
      continue;
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `📅 Coming up: ${req.title}`,
        body: `This is happening ${label} — don't forget!`,
        sound: 'default',
        data: { path: `/request/${req.id}` },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireDate },
    });
    scheduled.push(label);
  }

  if (scheduled.length === 0) {
    Alert.alert('Too close', 'Those reminder times have already passed.');
    return;
  }
  const skippedNote = skipped.length > 0 ? ` (skipped ${skipped.join(', ')} — already passed)` : '';
  Alert.alert('Reminders set 🔔', `We'll remind you ${scheduled.join(' and ')}.${skippedNote}`);
}
