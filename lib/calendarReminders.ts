import * as Calendar from 'expo-calendar';
import * as Notifications from 'expo-notifications';
import { Platform, Alert } from 'react-native';
import { combineDateAndTime } from './utils';
import type { Request } from '../types';

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
  try {
    await Calendar.createEventAsync(calendarId, {
      title: req.title,
      startDate: start,
      endDate: end,
      notes: `With ${otherName} — via VillageMates`,
    });
    Alert.alert('Added! 📅', `"${req.title}" is on your calendar.`);
  } catch {
    Alert.alert('Error', 'Could not add this to your calendar.');
  }
}

export function promptForReminder(req: Request) {
  Alert.alert('Set a reminder?', `Get a notification before "${req.title}".`, [
    { text: 'Not now', style: 'cancel' },
    { text: 'The morning of', onPress: () => scheduleRequestReminder(req, 'morning') },
    { text: '1 hour before', onPress: () => scheduleRequestReminder(req, 'hour') },
    { text: 'The day before', onPress: () => scheduleRequestReminder(req, 'day') },
  ]);
}

async function scheduleRequestReminder(req: Request, when: 'morning' | 'hour' | 'day') {
  if (Platform.OS === 'web') {
    Alert.alert('Reminder unavailable on web', 'Notifications are only available on the mobile app.');
    return;
  }

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
  let fireDate: Date;
  let label: string;
  if (when === 'morning') {
    fireDate = new Date(start);
    fireDate.setHours(8, 0, 0, 0);
    if (fireDate >= start) fireDate = new Date(start.getTime() - 3600000);
    label = 'this morning';
  } else if (when === 'hour') {
    fireDate = new Date(start.getTime() - 3600000);
    label = 'in an hour';
  } else {
    fireDate = new Date(start.getTime() - 24 * 3600000);
    label = 'tomorrow';
  }

  if (fireDate <= new Date()) {
    Alert.alert('Too close', 'That reminder time has already passed — try a shorter lead time.');
    return;
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
  Alert.alert('Reminder set 🔔', `We'll remind you ${label}.`);
}
