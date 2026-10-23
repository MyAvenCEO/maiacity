/**
 * The people of the region: names applicants are drawn from (southern Lower Saxony, with the
 * region's Turkish, Polish and Romanian communities).
 */
export const labourSettings = {
  // the public holidays of Lower Saxony (Niedersächsisches Gesetz über die Feiertage, § 2): days of general
  // rest (§ 4: public work that disturbs it is forbidden), paid as working days (§ 2 EntgFG)
  holidays: {
    rule: '§ 2 NFeiertagsG (Niedersachsen); § 2 EntgFG',
    rest: true,
    paid: true,
    fixed: [
      { month: 1, day: 1, label: 'Neujahr' },
      { month: 5, day: 1, label: 'Tag der Arbeit' },
      { month: 10, day: 3, label: 'Tag der Deutschen Einheit' },
      { month: 10, day: 31, label: 'Reformationstag' },
      { month: 12, day: 25, label: '1. Weihnachtstag' },
      { month: 12, day: 26, label: '2. Weihnachtstag' },
    ],
    easter: [
      { offset: -2, label: 'Karfreitag' },
      { offset: 1, label: 'Ostermontag' },
      { offset: 39, label: 'Christi Himmelfahrt' },
      { offset: 50, label: 'Pfingstmontag' },
    ],
  },
  names: {
    first: [
      'Andreas', 'Thomas', 'Michael', 'Stefan', 'Frank', 'Jürgen', 'Markus', 'Christian', 'Martin', 'Sebastian',
      'Tobias', 'Jan', 'Lukas', 'Florian', 'Daniel', 'Dennis', 'Kevin', 'Marco', 'Sven', 'Uwe',
      'Dirk', 'Ralf', 'Holger', 'Patrick', 'Alexander', 'Philipp', 'Niklas', 'Leon', 'Jonas', 'Tim',
      'Mehmet', 'Murat', 'Piotr', 'Tomasz', 'Dariusz', 'Ivan', 'Bogdan', 'Adrian', 'Emre', 'Luca',
      'Sabine', 'Anna', 'Julia', 'Katrin', 'Sandra', 'Stefanie', 'Nicole', 'Claudia', 'Melanie', 'Laura',
      'Lena', 'Sarah', 'Lisa', 'Marie', 'Hannah', 'Jessica', 'Christina', 'Anja', 'Birgit', 'Agnieszka',
    ],
    last: [
      'Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann',
      'Schäfer', 'Koch', 'Bauer', 'Richter', 'Klein', 'Wolf', 'Schröder', 'Neumann', 'Schwarz', 'Zimmermann',
      'Braun', 'Krüger', 'Hofmann', 'Hartmann', 'Lange', 'Schmitt', 'Werner', 'Schmitz', 'Krause', 'Meier',
      'Lehmann', 'Schmid', 'Schulze', 'Maier', 'Köhler', 'Herrmann', 'König', 'Walter', 'Mayer', 'Huber',
      'Kaiser', 'Fuchs', 'Peters', 'Lang', 'Scholz', 'Möller', 'Weiß', 'Jung', 'Hahn', 'Vogel',
      'Friedrich', 'Keller', 'Günther', 'Frank', 'Berger', 'Kowalski', 'Nowak', 'Yılmaz', 'Kaya', 'Popescu',
    ],
  },
};
