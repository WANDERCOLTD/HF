/**
 * Fake name generator for sim launch.
 * Used when no learner name is provided — produces a realistic-sounding
 * but clearly fictional name instead of a serial number.
 *
 * Pool: classic Hollywood / golden-age cinema first + last names. Mix and
 * match produces plausible "old movie" names without trademark issues.
 * Replaces the pre-2026-06-19 international pool which was reading as
 * stereotyping rather than realism.
 */

const FIRST_NAMES = [
  // Leading men — Golden Age
  "Humphrey", "Cary", "James", "Gary", "Spencer", "Clark", "Henry", "Gregory",
  "Burt", "Frank", "Errol", "Tyrone", "John", "Robert", "William", "Charles",
  "Orson", "Marlon", "Montgomery", "Kirk", "Yul", "Charlton", "Anthony", "Rock",
  "Tony", "Sidney", "Paul", "Steve", "Jack", "Dustin", "Richard", "Peter",
  "George", "Edward", "David", "Michael", "Donald", "Walter", "Joseph", "Lee",
  // Leading ladies — Golden Age
  "Audrey", "Katharine", "Bette", "Joan", "Vivien", "Ingrid", "Lauren", "Grace",
  "Marilyn", "Rita", "Ava", "Lana", "Judy", "Mae", "Greta", "Carole",
  "Olivia", "Barbara", "Veronica", "Faye", "Natalie", "Shirley", "Jane", "Doris",
  "Sophia", "Elizabeth", "Deborah", "Maureen", "Susan", "Eva", "Gloria", "Joanne",
  "Anne", "Mary", "Helen", "Ruth", "Dorothy", "Rosalind", "Claudette", "Myrna",
  // New Hollywood / 70s-80s
  "Diane", "Meryl", "Sissy", "Glenn", "Sigourney", "Goldie", "Geena",
  "Holly", "Demi", "Sharon", "Michelle", "Julianne", "Frances", "Annette", "Andie",
  "Harrison", "Al", "Warren", "Gene", "Robin", "Bill",
  "Bruce", "Mel", "Kevin", "Tom", "Denzel", "Morgan", "Samuel", "Wesley",
];

const LAST_NAMES = [
  // Golden Age — leading men
  "Bogart", "Grant", "Stewart", "Cooper", "Tracy", "Gable", "Fonda", "Peck",
  "Lancaster", "Sinatra", "Flynn", "Power", "Wayne", "Mitchum", "Holden", "Laughton",
  "Welles", "Brando", "Clift", "Douglas", "Brynner", "Heston", "Quinn", "Hudson",
  "Curtis", "Poitier", "Newman", "McQueen", "Nicholson", "Hoffman", "Burton", "Sellers",
  "Scott", "Robinson", "Niven", "Lemmon", "Cotten", "Marvin", "Cobb", "Hayden",
  // Golden Age — leading ladies
  "Hepburn", "Davis", "Crawford", "Leigh", "Bergman", "Bacall", "Kelly", "Monroe",
  "Hayworth", "Turner", "Gardner", "Garland", "West", "Garbo", "Lombard",
  "Stanwyck", "Lake", "Dunaway", "Wood", "MacLaine", "Day",
  "Loren", "Taylor", "Kerr", "Hayward", "Swanson", "Loy",
  "Russell", "Colbert",
  // New Hollywood / 70s-80s
  "Keaton", "Streep", "Spacek", "Close", "Weaver", "Hawn", "Midler", "Hunt",
  "Stone", "Pfeiffer", "McDormand", "Bening", "MacDowell",
  "Ford", "Pacino", "Redford", "Beatty", "Hackman", "Williams", "Murray",
  "Willis", "Gibson", "Costner", "Hanks", "Washington", "Freeman", "Jackson", "Snipes",
  "Reeves", "Cruise", "Penn", "Cage", "Travolta", "Spader", "Goldblum",
];

/** Returns a random fake full name, e.g. "Audrey Bogart" */
export function randomFakeName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}
