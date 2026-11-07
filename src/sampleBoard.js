// Placeholder board for testing until the game editor exists (step 6).
// Questions are [prompt, answer] for buzz-in questions, or objects for
// all-play and spot-the-difference ones (kept in sync with migrations 006 and
// 008, which update older copies).
export const sampleBoard = {
  title: 'Sample board',
  categories: [
    {
      name: 'Christmas Movies',
      questions: [
        ["What is the name of the Grinch's dog?", 'Max'],
        ["In 'Home Alone', what city does Kevin's family fly to without him?", 'Paris'],
        {
          prompt: 'Which movie has the line "You\'ll shoot your eye out!"?',
          answer: 'A Christmas Story',
          allplay: {
            format: 'single',
            seconds: 30,
            items: [{ answer: 'A Christmas Story/Christmas Story' }],
          },
        },
        [
          "According to Buddy in 'Elf', what are the four main food groups?",
          'Candy, candy canes, candy corns and syrup',
        ],
        [
          "In 'Die Hard', what is the name of the building where most of the action happens?",
          'Nakatomi Plaza',
        ],
      ],
    },
    {
      name: 'Geography',
      questions: [
        ['What is the capital of Canada?', 'Ottawa'],
        ['What is the longest river in South America?', 'The Amazon'],
        ['What is the smallest country in the world by area?', 'Vatican City'],
        {
          prompt: 'Name all seven continents.',
          answer: 'Africa, Antarctica, Asia, Australia, Europe, North America, South America',
          allplay: {
            format: 'list',
            seconds: 60,
            items: [
              { answer: 'Africa' },
              { answer: 'Antarctica' },
              { answer: 'Asia' },
              { answer: 'Australia/Oceania' },
              { answer: 'Europe' },
              { answer: 'North America' },
              { answer: 'South America' },
            ],
          },
        },
        ['Which African country was formerly known as Abyssinia?', 'Ethiopia'],
      ],
    },
    {
      name: 'Sports',
      questions: [
        ['How many players does each team have on the field in soccer?', '11'],
        ['Which country has won the most FIFA World Cups?', 'Brazil'],
        ['In bowling, what is three strikes in a row called?', 'A turkey'],
        ["In which sport would you perform a 'double axel'?", 'Figure skating'],
        ["Which boxer, known as 'The Greatest', was born Cassius Clay?", 'Muhammad Ali'],
      ],
    },
    {
      name: 'Science',
      questions: [
        ['Which planet is known as the Red Planet?', 'Mars'],
        ['What gas do plants absorb from the air to make food?', 'Carbon dioxide'],
        ['What is the chemical symbol for gold?', 'Au'],
        ['How many bones are in the adult human body?', '206'],
        ["What is the most abundant gas in Earth's atmosphere?", 'Nitrogen'],
      ],
    },
    {
      name: 'Music',
      questions: [
        ["Who sang 'All I Want for Christmas Is You'?", 'Mariah Carey'],
        ['Which band was made up of John, Paul, George and Ringo?', 'The Beatles'],
        {
          prompt: 'Match each Christmas song to the singer who made it famous.',
          answer: 'Wham!, Brenda Lee, José Feliciano, Elvis Presley',
          allplay: {
            format: 'blanks',
            seconds: 60,
            items: [
              { label: 'Last Christmas', answer: 'Wham!/Wham/George Michael' },
              { label: "Rockin' Around the Christmas Tree", answer: 'Brenda Lee' },
              { label: 'Feliz Navidad', answer: 'José Feliciano' },
              { label: 'Blue Christmas', answer: 'Elvis Presley/Elvis' },
            ],
          },
        },
        ['Which instrument usually has 88 keys?', 'Piano'],
        ["Who wrote the song 'White Christmas'?", 'Irving Berlin'],
      ],
    },
    {
      name: 'Food & Drink',
      questions: [
        ['What is the main ingredient in guacamole?', 'Avocado'],
        ['Which country does pizza come from?', 'Italy'],
        ['Which nut is used to make marzipan?', 'Almond'],
        {
          prompt: 'Spot the 4 differences!',
          answer: "No moon, no star on the tree, a window light is off, the snowman's hat is red",
          spotdiff: {
            left: '/samples/spot-a.svg',
            right: '/samples/spot-b.svg',
            spots: [
              { x: 0.85, y: 0.15 },
              { x: 0.5875, y: 0.233 },
              { x: 0.29, y: 0.52 },
              { x: 0.85, y: 0.46 },
            ],
          },
        },
        ['What kind of pastry are profiteroles made from?', 'Choux pastry'],
      ],
    },
  ],
}
