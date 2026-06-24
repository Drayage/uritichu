const SUITS = ['jade', 'sword', 'pagoda', 'star'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VALUE = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };
const POINT_VALUE = { '5':5,'10':10,'K':10 };

const SPECIAL_CARDS = {
  mahjong: { id:'mahjong', suit:null, rank:'mahjong', numericValue:1,  pointValue:0,   isSpecial:true },
  dog:     { id:'dog',     suit:null, rank:'dog',     numericValue:0,  pointValue:0,   isSpecial:true },
  phoenix: { id:'phoenix', suit:null, rank:'phoenix', numericValue:-1, pointValue:-25, isSpecial:true },
  dragon:  { id:'dragon',  suit:null, rank:'dragon',  numericValue:16, pointValue:25,  isSpecial:true },
};

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${suit}_${rank}`, suit, rank, numericValue: RANK_VALUE[rank], pointValue: POINT_VALUE[rank] || 0, isSpecial: false });
    }
  }
  deck.push({ ...SPECIAL_CARDS.mahjong });
  deck.push({ ...SPECIAL_CARDS.dog });
  deck.push({ ...SPECIAL_CARDS.phoenix });
  deck.push({ ...SPECIAL_CARDS.dragon });
  return deck;
}

function shuffleDeck(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function dealCards(deck) {
  const hands = { 0: [], 1: [], 2: [], 3: [] };
  for (let i = 0; i < 8; i++) {
    for (let p = 0; p < 4; p++) hands[p].push(deck[i * 4 + p]);
  }
  const remaining = { 0: [], 1: [], 2: [], 3: [] };
  for (let i = 32; i < 56; i++) remaining[i % 4].push(deck[i]);
  return { hands, remaining };
}

function sortHand(cards) {
  return [...cards].sort((a, b) => {
    if (a.numericValue !== b.numericValue) return a.numericValue - b.numericValue;
    if (a.suit && b.suit) return a.suit.localeCompare(b.suit);
    return 0;
  });
}

function cardById(id, deck) {
  return deck.find(c => c.id === id) || null;
}

export { createDeck, shuffleDeck, dealCards, sortHand, cardById, SUITS, RANKS, RANK_VALUE, SPECIAL_CARDS };
