export type RootStackParamList = {
  Home:       undefined;
  CreateRoom: undefined;
  Lobby:      { roomCode: string };
  GameTable:  { matchId: string };
  CardGallery: undefined;
  Tutorial:   undefined;
  Win:        { matchId: string; winnerId?: string; winnerName?: string; isDraw?: boolean };
};
