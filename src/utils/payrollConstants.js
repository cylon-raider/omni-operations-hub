// Payroll domain constants: departments, job roles, and overhead targets.

export const DEPARTMENTS = ['General', 'Oral Surgery', 'Ortho', 'Front Desk', 'Dr'];

export const JOB_ROLES = {
  'Front Desk': ['Concierge', 'Receptionist', 'Scheduler', 'Supervisor', 'General', 'Treatment Coordinator'],
  'Hygiene': ['Hygiene Assistant', 'Hygienist'],
  'Assistants': ['Assistant', 'OS Assistant', 'Ortho Tech', 'Sterilization Tech', 'Float', 'EFDA', 'Supervisor', 'Treatment Coordinator'],
  'Doctor': ['Doctor', 'Associate Doctor', 'Partner'],
};

export const ALL_ROLES = Object.values(JOB_ROLES).flat();

export const TARGETS = {
  STAFF_OVERHEAD: 0.25,  // Staff costs target limit (25%)
  DOCTOR_OVERHEAD: 0.28, // Doctor costs target limit (28%)
  CLINIC_HOURS: 59,      // Standard scheduled clinic operating hours
};

// Users with these emails are bootstrapped as payroll admins on first login
// and cannot be demoted from the Team → App Access screen.
// Kept in sync with the delete-privileged emails in firestore.rules.
export const OWNER_EMAILS = ['luckyj5521@gmail.com', 'cmarkel@gmail.com'];
