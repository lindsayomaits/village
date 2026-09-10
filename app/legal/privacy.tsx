import { LegalScreen, type LegalSection } from '../../components/LegalScreen';

const INTRO = [
  'Welcome to VillageMates ("VillageMates," "we," "our," or "us").',
  'VillageMates is a community platform that helps people connect with trusted members of their local communities to build relationships, organize activities, request or offer support, and strengthen neighborhood connections.',
  'Your privacy is important to us. This Privacy Policy explains how we collect, use, disclose, and protect your information when you use the VillageMates mobile application, website, and related services (collectively, the "Platform").',
  'By using VillageMates, you acknowledge that you have read and understood this Privacy Policy.',
];

const SECTIONS: LegalSection[] = [
  {
    heading: '1. Information We Collect',
    paragraphs: [
      'We collect information that you provide directly, information collected automatically through your use of the Platform, and information received from third parties.',
      'Information you provide may include: your name, email address, phone number, profile photo, username, password (stored securely in encrypted form through our authentication provider), city and neighborhood, ZIP code, family information you choose to share, children’s first names or nicknames (optional), children’s ages or grade levels (optional), interests, groups you join, events you create, messages you send, photos you upload, recommendations you post, comments, survey responses, support requests, and feedback.',
      'You should only share information that you are comfortable making available to others according to your privacy settings.',
    ],
  },
  {
    heading: '2. Location Information',
    paragraphs: ['VillageMates uses location information to help connect members within nearby communities. Depending on your device settings, we may collect approximate location, GPS location (only with your permission), city, neighborhood, and ZIP code.', 'You may disable precise location access through your device settings. Some features may not function properly without location access.'],
  },
  {
    heading: '3. Information Collected Automatically',
    paragraphs: ['When you use VillageMates, we automatically collect certain technical information, including device type, device ID, operating system, browser type, IP address, language preferences, time zone, app version, crash reports, diagnostic information, pages viewed, features used, search activity, referral source, session duration, and date and time of access.', 'This information helps us improve the Platform and diagnose technical issues.'],
  },
  {
    heading: '4. Information from Third Parties',
    paragraphs: ['We may receive information from identity verification providers (if implemented), analytics providers, authentication providers, social sign-in providers (if you choose to use them), payment processors (if subscriptions or payments are introduced), and customer support platforms.'],
  },
  {
    heading: '5. How We Use Your Information',
    paragraphs: ['We use your information to:'],
    bullets: [
      'Create and manage your account',
      'Connect you with nearby members and communities',
      'Provide requested features and services',
      'Personalize your experience',
      'Recommend groups, events, and connections',
      'Improve search results',
      'Provide customer support',
      'Send account notifications',
      'Respond to inquiries',
      'Detect fraud and abuse',
      'Maintain the safety and security of the Platform',
      'Enforce our Terms of Service',
      'Analyze Platform performance',
      'Develop new features',
      'Comply with legal obligations',
    ],
  },
  {
    heading: '6. Communications',
    paragraphs: ['We may send account notifications, security alerts, password reset emails, updates regarding your account, important service announcements, community notifications, event reminders, and product updates.', 'Where required by law, we will obtain your consent before sending marketing communications. You may opt out of marketing emails at any time by following the unsubscribe instructions included in those emails.'],
  },
  {
    heading: '7. Information You Share with Others',
    paragraphs: ['VillageMates is designed to facilitate community connections. Depending on your privacy settings, other users may see information such as your name, profile photo, neighborhood, bio, interests, groups, posts, comments, recommendations, events, and mutual connections.', 'Please consider carefully what information you choose to share. Information you make visible to other users may be copied, saved, or shared outside the Platform.'],
  },
  {
    heading: "8. Children's Privacy",
    paragraphs: [
      'VillageMates is intended for adults aged 18 and older.',
      'Parents and guardians may choose to include limited information about their children, such as first names, nicknames, ages, or grade levels, to facilitate community interactions.',
      'VillageMates does not knowingly collect personal information directly from children under the age of 13. Parents remain solely responsible for any information they choose to share about their children.',
      'If you believe that a child has provided personal information directly to VillageMates without appropriate consent, please contact us so that we can investigate and remove the information where appropriate.',
    ],
  },
  {
    heading: '9. How We Share Information',
    paragraphs: [
      'We may share information with service providers that assist with cloud hosting, analytics, customer support, authentication, payment processing, email delivery, push notifications, and security monitoring. These providers are authorized to use your information only as necessary to provide services on our behalf.',
      'Information you choose to make visible through your profile or activity may be shared with other users according to your privacy settings.',
      'We may disclose information if we believe doing so is necessary to comply with applicable law, respond to lawful requests from public authorities, protect the rights, property, or safety of VillageMates, our users, or others, investigate fraud or illegal activity, or enforce our Terms of Service.',
      'If VillageMates is involved in a merger, acquisition, financing, reorganization, bankruptcy, or sale of assets, your information may be transferred as part of that transaction.',
    ],
  },
  {
    heading: '10. We Do Not Sell Personal Information',
    paragraphs: ['VillageMates does not sell your personal information to third parties for monetary compensation. If applicable privacy laws define certain advertising or analytics practices as "sharing" or "selling," we will provide any required notices and choices.'],
  },
  {
    heading: '11. Data Security',
    paragraphs: ['We implement reasonable administrative, technical, and physical safeguards designed to protect your information, which may include encryption in transit, secure authentication, access controls, security monitoring, regular software updates, and cloud security protections.', 'However, no method of electronic transmission or storage is completely secure, and we cannot guarantee absolute security.'],
  },
  {
    heading: '12. Data Retention',
    paragraphs: ['We retain personal information only for as long as reasonably necessary to provide the Platform, comply with legal obligations, resolve disputes, enforce our agreements, and protect the security of the Platform. When information is no longer needed, we will delete or anonymize it where reasonably practicable.'],
  },
  {
    heading: '13. Your Choices',
    paragraphs: ['You may update your profile information, change your privacy settings, disable location permissions, opt out of marketing emails, request deletion of your account, and request access to certain personal information, where required by law.', 'Deleting your account may not immediately remove all information from backups or records retained to comply with legal obligations.'],
  },
  {
    heading: '14. California Privacy Rights',
    paragraphs: ['If you are a California resident, you may have rights under the California Consumer Privacy Act (CCPA), as amended by the California Privacy Rights Act (CPRA), including the right to know what personal information we collect, request deletion of eligible personal information, request correction of inaccurate personal information, request access to certain information, and exercise applicable opt-out rights without discrimination. To exercise these rights, contact us using the information below.'],
  },
  {
    heading: '15. International Users',
    paragraphs: ['VillageMates is intended primarily for users located in the United States. If you access the Platform from another country, you understand that your information may be transferred to and processed in the United States, where privacy laws may differ from those in your jurisdiction.'],
  },
  {
    heading: '16. Third-Party Links and Services',
    paragraphs: ['The Platform may contain links to third-party websites, products, or services. VillageMates is not responsible for the privacy practices or content of those third parties. We encourage you to review their privacy policies before providing personal information.'],
  },
  {
    heading: '17. Changes to This Privacy Policy',
    paragraphs: ['We may update this Privacy Policy from time to time. If we make material changes, we will notify users through the Platform, by email, or by other appropriate means. Your continued use of VillageMates after the effective date of the updated Privacy Policy constitutes acceptance of the revised policy.'],
  },
];

export default function PrivacyScreen() {
  return <LegalScreen title="Privacy Policy" updated="Effective 22 July 2026" intro={INTRO} sections={SECTIONS} />;
}
