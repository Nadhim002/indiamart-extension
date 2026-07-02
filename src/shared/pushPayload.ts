// The Expo push message shape — single source of truth. Built identically by
// the service worker (production sends) and the panel's test-notification
// button, so the two can never drift.
//
// phonecall style = DATA-ONLY push (no title/body at the top level) so the
// system does not auto-display it; the phone's native LeadNotificationService
// picks it up and fires a full-screen intent. Any other style = a normal
// heads-up notification on the banner channel.

import { CHANNEL_BANNER } from './channels';

export interface ExpoMessageInput {
  token: string;
  notificationStyle: string;
  title: string;
  body: string;
  /** The `data` payload delivered to the device. */
  payload: Record<string, unknown>;
}

export function buildExpoMessage({ token, notificationStyle, title, body, payload }: ExpoMessageInput) {
  const isPhonecall = notificationStyle === 'phonecall';
  return isPhonecall
    ? {
        to: token,
        data: { type: 'phonecall', title, body, lead: JSON.stringify(payload) },
        priority: 'high',
        _contentAvailable: true,
      }
    : {
        to: token,
        title,
        body,
        channelId: CHANNEL_BANNER,
        priority: 'high',
        sound: 'default',
        data: payload,
      };
}
