//#region imports
import {
    generateReport,
    positionsFromPGN,
} from "./classificationLogic/createAnalysis.js";
import {
    whitePlayer,
    blackPlayer,
    updateBoardPlayers,
    traverseMoves,
    setBlackPlayer,
    setWhitePlayer,
} from "./board.js";
import { Stockfish } from "./engine.js";
import { Position, EngineLine, Report, SavedAnalysis } from "./types.js";
//#endregion

//TODO: remove global variables
export let ongoingEvaluation = false;

export let evaluatedPositions: Position[] = [];
export let reportResults: Report | undefined;

function logAnalysisInfo(message: string) {
    $("#status-message").css("color", "white");
    $("#status-message").html(message);
}

function logAnalysisError(message: string) {
    $("#evaluation-progress-bar").css("display", "none");
    $("#secondary-message").html("");
    $("#status-message").css("color", "rgb(255, 53, 53)");
    $("#status-message").html(message);

    ongoingEvaluation = false;
}

async function parsePGN(pgn?: string): Promise<Position[]> {
    try {
        const positions = await positionsFromPGN(pgn);
        return positions;
    } catch {
        throw logAnalysisError("Failed to parse PGN.");
    }
}

// #region evaluation

async function evaluate() {
    // Remove report cards, display progress bar
    $("#report-cards").css("display", "none");
    $("#evaluation-progress-bar").css("display", "inline");

    // Disallow evaluation if another evaluation is ongoing
    if (ongoingEvaluation) return;
    ongoingEvaluation = true;

    // Extract input PGN and target depth
    let pgn = $("#pgn").val()!.toString();
    let depth = parseInt($("#depth-slider").val()!.toString());

    // Content validate PGN input
    if (pgn.length == 0) {
        return logAnalysisError("Provide a game to analyse.");
    }

    // Post PGN to server to have it parsed
    logAnalysisInfo("Parsing PGN...");

    let positions: Position[] = await parsePGN(pgn);

    $("#secondary-message").html(
        "It can take around a minute to process a full game."
    );

    // Fetch cloud evaluations where possible
    positions = await fetchCloudEvaluations(positions, depth);

    // Evaluate remaining positions
    let workerCount = 0;

    const stockfishManager: NodeJS.Timeout = setInterval(
        () =>
            stockfishManagerCallback(
                positions,
                workerCount,
                depth,
                stockfishManager
            ),
        10
    );
}

async function cloudEvaluation(fen: string) {
    try {
        const cloudEvaluationResponse = await fetch(
            `https://lichess.org/api/cloud-eval?fen=${fen}&multiPv=2`,
            {
                method: "GET",
            }
        );

        if (!cloudEvaluationResponse || !cloudEvaluationResponse.ok) return;

        return await cloudEvaluationResponse.json();
    } catch {}
}

async function fetchCloudEvaluations(positions: Position[], depth: number) {
    for (let position of positions) {
        let queryFen = position.fen.replace(/\s/g, "%20");
        const cloudEvaluationResponse = await cloudEvaluation(queryFen);

        if (!cloudEvaluationResponse) break;

        position.topLines = cloudEvaluationResponse.pvs.map(
            (pv: any, id: number) => {
                const evaluationType = pv.cp == undefined ? "mate" : "cp";
                const evaluationScore = pv.cp ?? pv.mate ?? "cp";

                let line: EngineLine = {
                    id: id + 1,
                    depth: depth,
                    moveUCI: pv.moves.split(" ")[0] ?? "",
                    evaluation: {
                        type: evaluationType,
                        value: evaluationScore,
                    },
                };

                let cloudUCIFixes: { [key: string]: string } = {
                    e8h8: "e8g8",
                    e1h1: "e1g1",
                    e8a8: "e8c8",
                    e1a1: "e1c1",
                };
                line.moveUCI = cloudUCIFixes[line.moveUCI] ?? line.moveUCI;

                return line;
            }
        );

        if (position.topLines?.length != 2) {
            break;
        }

        position.worker = "cloud";

        let progress =
            ((positions.indexOf(position) + 1) / positions.length) * 100;
        $("#evaluation-progress-bar").attr("value", progress);
        logAnalysisInfo(`Evaluating positions... (${progress.toFixed(1)}%)`);
    }

    return positions;
}

function stockfishManagerCallback(
    positions: Position[],
    workerCount: number,
    depth: number,
    stockfishManager: NodeJS.Timeout
) {
    // If all evaluations have been generated, move on
    if (!positions.some((pos) => !pos.topLines)) {
        clearInterval(stockfishManager);

        logAnalysisInfo("Evaluation complete.");
        $("#evaluation-progress-bar").val(100);

        evaluatedPositions = positions;
        ongoingEvaluation = false;

        report();

        return;
    }

    // Find next position with no worker and add new one
    for (let position of positions) {
        if (position.worker || workerCount >= 8) continue;

        let worker = new Stockfish();
        worker.evaluate(position.fen, depth).then((engineLines) => {
            position.topLines = engineLines;
            workerCount--;
        });

        position.worker = worker;
        workerCount++;
    }

    // Update progress monitor
    let workerDepths = 0;
    for (let position of positions) {
        if (typeof position.worker == "object") {
            workerDepths += position.worker.depth;
        } else if (typeof position.worker == "string") {
            workerDepths += depth;
        }
    }

    let progress = (workerDepths / (positions.length * depth)) * 100;

    $("#evaluation-progress-bar").attr("value", progress);
    logAnalysisInfo(`Evaluating positions... (${progress.toFixed(1)}%)`);
}

// #endregion

function loadReportCards() {
    // Reset chess board, draw evaluation for starting position
    traverseMoves(-Infinity);

    // Reveal report cards and update accuracies
    $("#report-cards").css("display", "flex");
    $("#white-accuracy").html(
        `${reportResults?.accuracies.white.toFixed(1) ?? "100"}%`
    );
    $("#black-accuracy").html(
        `${reportResults?.accuracies.black.toFixed(1) ?? "100"}%`
    );

    // Remove progress bar and any status message
    $("#evaluation-progress-bar").css("display", "none");
    logAnalysisInfo("");
}

async function report() {
    // Remove reset progress bar
    $("#secondary-message").html("");
    $("#evaluation-progress-bar").attr("value", null);
    logAnalysisInfo("Generating report...");

    // Post evaluations and get report results
    try {
        const positions: Position[] = evaluatedPositions.map((pos) => {
            if (pos.worker != "cloud") {
                pos.worker = "local";
            }
            return pos;
        });

        // Set report results to results given by server
        reportResults = await generateReport(positions);

        loadReportCards();
    } catch {
        return logAnalysisError("Failed to generate report.");
    }
}

$("#review-button").on("click", () => {
    if ($("#load-type-dropdown").val() == "json") {
        try {
            let savedAnalysis: SavedAnalysis = JSON.parse(
                $("#pgn").val()?.toString()!
            );

            setWhitePlayer(savedAnalysis.players.white);
            setBlackPlayer(savedAnalysis.players.black);
            updateBoardPlayers();

            reportResults = savedAnalysis.results;
            loadReportCards();
        } catch {
            logAnalysisError("Invalid savefile.");
        }
    } else {
        evaluate();
    }
});

$("#depth-slider").on("input", () => {
    let depth = parseInt($("#depth-slider").val()?.toString()!);

    if (depth <= 14) {
        $("#depth-counter").html(depth + " ⚡");
    } else if (depth <= 17) {
        $("#depth-counter").html(depth + " 🐇");
    } else {
        $("#depth-counter").html(depth + " 🐢");
    }
});
