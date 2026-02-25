/**
 * Fake name generator for sim launch.
 * Used when no learner name is provided — produces a realistic-sounding
 * but clearly fictional name instead of a serial number.
 */

const FIRST_NAMES = [
  "Alex", "Blake", "Casey", "Dana", "Elise", "Finn", "Grace", "Harper",
  "Imani", "Jordan", "Kai", "Leila", "Morgan", "Nadia", "Omar", "Priya",
  "Quinn", "Remy", "Sage", "Tara", "Uma", "Val", "Wren", "Xio",
  "Yara", "Zeke", "Aiden", "Bea", "Cole", "Dani", "Eden", "Frankie",
  "Glen", "Hazel", "Iris", "Jules", "Kieran", "Luca", "Mila", "Nico",
  "Olive", "Phoenix", "River", "Sasha", "Theo", "Uri", "Vera", "Winter",
];

const LAST_NAMES = [
  "Ahmed", "Baxter", "Chen", "Diallo", "Evans", "Ferreira", "Garcia",
  "Hassan", "Ishida", "James", "Kim", "Larson", "Moreau", "Nakamura",
  "Osei", "Patel", "Quinn", "Reyes", "Sharma", "Torres", "Ueda",
  "Vasquez", "Walsh", "Xu", "Yamamoto", "Zhao", "Anders", "Brooks",
  "Costa", "Dubois", "Ellis", "Foster", "Grant", "Hill", "Ibarra",
  "Jensen", "Khan", "Lima", "Mori", "Nour", "Ortiz", "Park", "Reid",
  "Santos", "Taylor", "Vance", "Wood", "Young", "Zola",
];

/** Returns a random fake full name, e.g. "Elise Moreau" */
export function randomFakeName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}
