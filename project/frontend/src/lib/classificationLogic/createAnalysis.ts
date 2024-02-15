import { parse, ParsedPGN } from "pgn-parser";
import { Chess, Move } from "chess.js";
import { Position } from "./types/Position.js";
import { Position as EvaluatedPosition, Profile } from "../types.js";
import { Report } from "../types.js";
import analyse from "./analysis.js";
import { whitePlayer, blackPlayer, updateBoardPlayers } from "../board.js";
import { PGNTag } from "./types/PGN.js";

// #region ParsePGNToPositions

export async function positionsFromPGN(pgn?: string): Promise<Position[]> {
    if (!pgn) throw new Error("PGN not provided to parse");

    const parsedPGN: ParsedPGN = PGNToJSON(pgn);
    setPlayers(parsedPGN);
    const positions: Position[] = generatePositions(parsedPGN);

    return positions;
}

function setPlayers(parsedPGN: ParsedPGN) {
    const tags: PGNTag = mapPGNHeaders(parsedPGN);
    setPlayer(whitePlayer, tags.White, tags.WhiteElo);
    setPlayer(blackPlayer, tags.Black, tags.BlackElo);
    updateBoardPlayers();
}

function mapPGNHeaders(parsedPGN: ParsedPGN) {
    return (
        parsedPGN.headers?.reduce((tags, obj) => {
            tags[obj.name] = obj.value;
            return tags;
        }, {} as PGNTag) ?? {}
    );
}

function setPlayer(player: Profile, username?: string, rating?: string) {
    player.username = username ?? player.username;
    player.rating = rating ?? player.rating;
}

function PGNToJSON(pgn: string): ParsedPGN {
    const [parsedPGN] = parse(pgn);

    if (!parsedPGN) {
        throw new Error("Failed to parse PGN");
    }

    return parsedPGN;
}

function generatePositions(parsedPGN: ParsedPGN): Position[] {
    const board = new Chess();
    const positions: Position[] = [];
    positions.push({ fen: board.fen() });

    for (const pgnMove of parsedPGN.moves) {
        const moveSAN = pgnMove.move;
        const virtualBoardMove = makeVirtualBoardMove(board, moveSAN);
        const moveUCI = virtualBoardMove.from + virtualBoardMove.to;
        positions.push({
            fen: board.fen(),
            move: { san: moveSAN, uci: moveUCI },
        });
    }

    return positions;
}

// Checks if a move can be made. If it can be made
// the move is returned
function makeVirtualBoardMove(board: Chess, moveSAN: string): Move {
    try {
        const virtualMove = board.move(moveSAN);
        return virtualMove;
    } catch (err) {
        throw new Error("PGN contains illegal moves");
    }
}

// #endregion

// #region GenerateReport

export async function generateReport(
    positions: EvaluatedPosition[]
): Promise<Report> {
    try {
        const results = await analyse(positions);
        return results;
    } catch (err) {
        throw new Error("Failed to generate report");
    }
}

// #endregion
