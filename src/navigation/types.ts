export type RootStackParamList = {
  Home:       undefined;
  CreateRoom: undefined;
  Lobby:      { roomCode: string };
  GameTable:  { matchId: string };
  CardGallery: undefined;
  Tutorial:   undefined;
  Win:        { winnerId: string; winnerName: string; matchId: string };
};
