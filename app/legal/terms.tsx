import { LegalScreen, type LegalSection } from '../../components/LegalScreen';

const INTRO = [
  'Welcome to VillageMates ("VillageMates," "we," "our," or "us").',
  'These Terms of Service ("Terms") govern your use of the VillageMates mobile application, website, and related services (collectively, the "Platform").',
  'By creating an account or using VillageMates, you agree to these Terms. If you do not agree, do not use the Platform.',
];

const SECTIONS: LegalSection[] = [
  {
    heading: '1. What VillageMates Is',
    paragraphs: ['VillageMates is a technology platform designed to help people connect with members of their communities and trusted networks. VillageMates allows users to:'],
    bullets: [
      'connect with neighbors and families',
      'request or offer help',
      'communicate with one another',
      'organize activities',
      'build community relationships',
    ],
  },
  {
    paragraphs: ['VillageMates does not provide:'],
    bullets: ['childcare', 'babysitting', 'transportation', 'caregiving', 'medical services', 'security services', 'emergency services', 'employment services', 'professional advice'],
  },
  { paragraphs: ['VillageMates is not an employer, staffing agency, daycare, transportation company, or social services provider.'] },
  {
    heading: '2. Eligibility',
    paragraphs: ['You must be at least 18 years old to create an account. By using VillageMates, you represent that:'],
    bullets: ['the information you provide is accurate;', 'you have authority to create your account;', 'you will comply with all applicable laws.'],
  },
  {
    heading: '3. Your Responsibility',
    paragraphs: ['You are solely responsible for:'],
    bullets: [
      'deciding whom to trust;',
      'deciding whether to meet another user;',
      'supervising your children;',
      'verifying identities;',
      'protecting your property;',
      'protecting your personal information;',
      'evaluating whether another member is appropriate for your family.',
    ],
  },
  { paragraphs: ['VillageMates cannot and does not guarantee that any member is trustworthy, qualified, truthful, or safe.'] },
  {
    heading: '4. VillageMates Does Not Screen or Endorse Users',
    paragraphs: ['Unless explicitly stated otherwise, VillageMates does not:'],
    bullets: ['conduct background checks on all users;', 'verify identities;', 'verify parenting experience;', 'verify professional qualifications;', 'certify users;', 'endorse members.'],
  },
  { paragraphs: [
    'Even if VillageMates offers optional verification features in the future, those features should not be relied upon as a guarantee of safety or suitability.',
    'Users are responsible for conducting their own due diligence before interacting with anyone.',
  ] },
  {
    heading: '5. Offline Interactions',
    paragraphs: ['VillageMates has no control over interactions that occur outside the Platform. This includes:'],
    bullets: ['babysitting;', 'carpools;', 'play dates;', 'home visits;', 'borrowing or lending items;', 'volunteering;', 'pet care;', 'purchases;', 'exchanges;', 'community gatherings;', 'emergency assistance.'],
  },
  { paragraphs: ['You assume all risks associated with meeting another user or allowing another user to interact with you, your children, your family members, your home, or your property.'] },
  {
    heading: '6. Children',
    paragraphs: ['Parents and legal guardians remain solely responsible for:'],
    bullets: ['supervising children;', 'transportation;', 'pickup and drop-off;', 'emergency contacts;', 'medical decisions;', 'childcare arrangements.'],
  },
  { paragraphs: ['VillageMates never supervises children and is not responsible for the safety or well-being of minors.'] },
  {
    heading: '7. Safety',
    paragraphs: ['VillageMates encourages users to exercise good judgment. We recommend that users:'],
    bullets: ['meet in public initially when appropriate;', 'verify identities independently;', 'tell someone where they are meeting;', 'avoid sharing sensitive information prematurely;', 'trust their instincts.'],
  },
  { paragraphs: ['These suggestions do not create any duty for VillageMates to protect users.'] },
  {
    heading: '8. Community Standards',
    paragraphs: ['Users may not:'],
    bullets: ['impersonate another person;', 'harass or threaten others;', 'discriminate against users;', 'engage in fraud or scams;', 'post illegal content;', 'endanger children;', 'violate laws;', 'upload malicious software;', 'misuse the Platform.'],
  },
  { paragraphs: ['VillageMates may suspend or remove accounts at its sole discretion.'] },
  {
    heading: '9. User Content',
    paragraphs: [
      'You retain ownership of content you post.',
      'You grant VillageMates a worldwide, non-exclusive, royalty-free license to host, display, reproduce, and distribute that content as necessary to operate and improve the Platform.',
      'You represent that you have the rights necessary to post your content.',
    ],
  },
  {
    heading: '10. Assumption of Risk',
    paragraphs: ['You acknowledge that interacting with people online and offline carries inherent risks. You voluntarily assume all risks associated with:'],
    bullets: ['meeting members;', 'inviting others into your home;', "visiting another person's home;", 'allowing children to interact;', 'transportation;', 'lending property;', 'community activities;', 'exchanging information.'],
  },
  {
    heading: '11. Release',
    paragraphs: ['To the fullest extent permitted by law, you release VillageMates and its officers, directors, employees, contractors, investors, affiliates, and agents from claims arising out of:'],
    bullets: ['personal injury;', 'death;', 'emotional distress;', 'theft;', 'assault;', 'property damage;', 'disputes between users;', 'childcare decisions;', 'transportation arrangements;', 'negligence of another user;', 'actions of third parties.'],
  },
  {
    heading: '12. Disclaimer of Warranties',
    paragraphs: ['The Platform is provided "AS IS" and "AS AVAILABLE." VillageMates makes no warranties regarding:'],
    bullets: ['availability;', 'uptime;', 'reliability;', 'accuracy;', 'completeness;', 'user behavior;', 'compatibility;', 'security.'],
  },
  { paragraphs: ['We disclaim all warranties, express or implied, including merchantability, fitness for a particular purpose, and non-infringement, to the maximum extent permitted by law.'] },
  {
    heading: '13. Limitation of Liability',
    paragraphs: ['To the fullest extent permitted by law, VillageMates shall not be liable for any indirect, incidental, consequential, special, exemplary, or punitive damages arising from your use of the Platform.', "VillageMates's total liability for any claim shall not exceed the greater of:"],
    bullets: ['$100 USD; or', 'the amount you paid VillageMates during the twelve months preceding the claim.'],
  },
  { paragraphs: ['Some jurisdictions do not allow certain limitations, so portions of this section may not apply to you.'] },
  {
    heading: '14. Indemnification',
    paragraphs: ["You agree to defend, indemnify, and hold harmless VillageMates and its affiliates, officers, directors, employees, contractors, and agents from any claims, damages, liabilities, losses, expenses, and attorneys' fees arising from:"],
    bullets: ['your use of the Platform;', 'your interactions with other users;', 'your violation of these Terms;', 'your violation of applicable laws;', 'your content;', 'injury or damage resulting from your conduct.'],
  },
  {
    heading: '15. Termination',
    paragraphs: ['VillageMates may suspend or terminate any account at any time for violations of these Terms or if we reasonably believe continued access could harm other users or the Platform.'],
  },
  {
    heading: '16. Changes to the Service',
    paragraphs: ['VillageMates may modify, suspend, or discontinue any feature of the Platform at any time without liability.'],
  },
  {
    heading: '17. Governing Law',
    paragraphs: [
      'These Terms are governed by the laws of the State of Texas, without regard to conflict of law principles.',
      'Any disputes shall be resolved in the state or federal courts located in Travis County, Texas, unless applicable law requires otherwise.',
    ],
  },
  {
    heading: '18. Changes to These Terms',
    paragraphs: [
      'We may update these Terms from time to time. If changes are material, we will provide notice through the Platform or by email.',
      'Continued use of VillageMates after the effective date constitutes acceptance of the updated Terms.',
    ],
  },
];

export default function TermsScreen() {
  return <LegalScreen title="Terms of Service" updated="Last updated: 22 July 2026" intro={INTRO} sections={SECTIONS} />;
}
