/**
 * Ultra Super Aggressive Attack — the `super_ultra_aggressive` playing style.
 *
 * EDUCATIONAL USE ONLY — FAIR-PLAY SAFE
 * This project is a study/research tool for building a chess engine that can
 * play in a variety of styles (normal, aggressive, ultra-aggressive). It is
 * intended for learning, offline analysis, and engine-variation research. It
 * is anti-cheat compliant and fair-play safe: it never assists a player in a
 * rated or live online game, and it must not be used to gain an unfair
 * advantage against human opponents.
 *
 * Everything that is specific to the "Ultra Super Aggressive Attack vs <=1100"
 * style lives in this one file so that enhancing the style (a new motif, trap,
 * or tactic for the next release) never touches the large hint-engine.js.
 *
 * The attack is organized as a clean, phase-based pipeline so the aggression
 * stays coherent and readable rather than opportunistic:
 *
 *   1. BUILD-UP   — gain the initiative with sound setup (develop with attack,
 *                   opening lines, pawn storms, king-zone attackers).
 *   2. BREAK-THROUGH — create concrete threats and win material or the king:
 *                   fork / pin / skewer, cage and suffocation, mating nets,
 *                   exchange sacrifices, back-rank and uncastled-king strikes.
 *   3. FINISH     — convert the advantage fast: forced mate sequences, second-
 *                   move vision, endgame kills.
 *
 * The host engine injects the shared chess helpers it already owns (via
 * `createEngine(utils)`); this module stays dependency-free beyond those and
 * owns, end to end:
 *
 *   1. Profile    — weights, risk budget, sacrifice tolerance, phase scale.
 *   2. Primitives — every attack motif detector (cage/hunt family, kill-
 *                   geometry mates, mating-square arithmetic, hanging pieces,
 *                   back ranks, opening strikes, second-move vision, tactics).
 *   3. computeFeatures(ctx) — turns a winning context into the flat feature
 *      blob the host merges into the candidate.
 *   4. styleBonus / humanFeel / annotate / choosePlan / winningPlan — the
 *      style-aware output the host delegates to.
 *
 * Script-loading mirrors core-utils.js / hint-engine.js (classic global), and
 * it is CommonJS-export friendly for the vm test harness without breaking the
 * browser path.
 */
(function (root) {
  'use strict';

  function createEngine(utils) {
    const U = utils || {};
    const isSquareAttacked = U.isSquareAttacked;   // (board, target, byColor) -> boolean
    const findKing = U.findKing;                    // (board, isWhite) -> {row,col}|null
    const pieceAttacksSquare = U.pieceAttacksSquare; // (board,row,col,tr,tc) -> boolean
    const applyMoveToBoard = U.applyMoveToBoard;     // (board, uci) -> board
    const applyMoveToFen = U.applyMoveToFen;         // (fen, uci) -> fen
    const getPieceAt = U.getPieceAt;                 // (board, sq) -> piece|undefined
    const detectGamePhase = U.detectGamePhase;       // (fen) -> 'opening'|'middlegame'|'endgame'
    const multiThreatCount = U.multiThreatCount;     // (board, to, playerIsWhite) -> int
    const squareToCoords = U.squareToCoords;         // (sq) -> {row,col}

    // ── Style profile ─────────────────────────────────────────────────
    const profile = {
      id: 'super_ultra_aggressive',
      name: 'Ultra Super Aggressive Attack',
      desc: 'A fearless, organized attack built for sound setup first, then a relentless break-through: develop into the enemy king\'s face, rip off the pawn shield, fork/pin/skewer the big pieces, and sacrifice boldly to finish games fast against <=1100 opponents.',
      // These are objective-evaluation budgets in centipawns, not a claim that
      // every sacrificed pawn is compensated. They widen as a position worsens.
      riskBudget: { winning: 200, advantage: 350, equal: 600, worse: 850, desperate: 1200 },
      sacrificeTolerance: 1500,
      kingHuntBonus: 260,
      diversity: 0.18,
      weights: {
        check: 280,
        doubleCheck: 190,
        forcingPly: 80,
        kingPressure: 120,
        defenderRemoval: 130,
        tempo: 80,
        development: 35,
        openKingFile: 160,
        sustainedAttack: 190,
        soundSacrifice: 300,
        speculativeSacrifice: 180,
        penetration: 95,
        deepPenetration: 140,
        pawnStorm: 120,
        passedPawnPush: 60,
        complexity: 80,
        simplification: -160,
        ownKingDanger: -5,
        unsupportedAttack: -5,
        // ── Build-up vocabulary (Berserker-aggression additions) ──
        attackUnits: 26,
        practicalChances: 40,
        complexityStructural: 45,
        greekGift: 120,
        drawContempt: 30,
        overload: 55,
        developmentWithAttack: 25,
        // ── Break-through weights ──
        kingCage: 60,
        kingSuffocation: 220,
        backRank: 80,
        shieldStrike: 170,
        contactCheck: 90,
        exchangeSac: 200,
        kingChase: 70,
        punishUncastled: 100,
        rookLift: 45,
        // ── Kill-geometry weights ──
        kingMobility: 75,
        smotheredMate: 260,
        anastasiaMate: 190,
        arabianMate: 190,
        bodenMate: 160,
        forcedMateNet: 300,
        undefendedHit: 95,
        // ── Mating-square arithmetic weights ──
        matingMath: 105,
        squareOutnumber: 85,
        // ── Position-level exploitation weights ──
        hangingPieceGrab: 75,
        backRankExploit: 90,
        // ── Opening-strike weights ──
        scholarTrap: 110,
        legalsTrap: 100,
        laskerTrap: 120,
        // ── Second-move vision weight ──
        followUpVision: 70,
        // ── Tactical-toolkit weights ──
        knightFork: 90,
        pin: 80,
        skewer: 85,
        discoveredAttack: 75,
        endgameCoup: 70,
        // ── Fast-finish weights ──
        earlyQueen: 120,
        quickPressure: 130,
        fastFinish: 150,
        // ── Fast-kill aggression weights ──
        mateSpeed: 130,
        narrowEscape: 100,
        sustainedPressure: 115,
        windmillAttack: 150,
        corridorMate: 170,
        epauletteMate: 180,
        queenSacForCharge: 165,
        urgencyTax: -230,
        attackerTradePenalty: -110,
        // ── V2 strategic-layer weights ──
        // Siege continuity: consecutive hints advancing ONE coherent plan
        // beat greedy re-picking every position.
        siegeContinuity: 95,
        // Sacrifice mechanism classification: a sacrifice must state its
        // mechanism (deflection of the only defender / line opening /
        // tempo gain) AND show concrete follow-up, or it is penalized as
        // unexplained rather than romanticized as fearless.
        sacMechanismDeflect: 150,
        sacMechanismLineOpen: 135,
        sacMechanismTempo: 115,
        unexplainedSacrifice: -130,
        // Quiet attacking prep: Kh1/Rfd1/h3 — the net-closing moves real
        // strong attackers play between blows.
        quietKingPrep: 80,
        quietRookFile: 70,
        quietPawnWedge: 60,
        // Zero-freedom initiative: lines where every opponent reply is a
        // king move, capture, or block — the defender never gets a free move.
        zeroFreedom: 170
      },
      phaseAggressionScale: 1.5
    };

    // ── Attack-unit S-curve (for the king-zone attacker-quality feature) ─
    function attackUnitsToBonus(units) {
      if (units <= 0) return 0;
      if (units <= 4) return units * 0.7;            // build-up phase
      if (units <= 8) return 2.8 + (units - 4) * 1.3; // acceleration
      return 8 + (units - 8) * 1.6;                  // full swarm
    }

    // ── Break-through: cage & hunt primitives ──────────────────────────
    // How many of the enemy king's escape squares are occupied or attacked?
    // This is the tightness of the mating net, independent of material.
    function kingCageCoverage(board, attackerIsWhite, kingPos) {
      if (!kingPos) return 0;
      let covered = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const tr = kingPos.row + dr, tc = kingPos.col + dc;
        if (tr < 0 || tr > 7 || tc < 0 || tc > 7) continue;
        if (board[tr][tc]) { covered++; continue; }
        if (isSquareAttacked(board, { row: tr, col: tc }, attackerIsWhite ? 'w' : 'b')) covered++;
      }
      return covered;
    }

    function backRankThreat(board, enemyKing, destination, playerIsWhite) {
      if (!enemyKing) return false;
      const backRow = playerIsWhite ? 0 : 7;
      if (enemyKing.row !== backRow) return false;
      if (destination.row !== backRow) return false;
      if (destination.col === enemyKing.col) return false;
      // A real back-rank threat: the moved piece sits on the back rank with a
      // clear line of sight to the king along that rank.
      const step = destination.col < enemyKing.col ? 1 : -1;
      for (let c = destination.col + step; c !== enemyKing.col; c += step) {
        if (c < 0 || c > 7) return false;
        if (board[backRow][c]) return false;
      }
      return true;
    }

    function pawnShieldStrike(captured, destination, enemyKing) {
      if (!captured || captured.toLowerCase() !== 'p' || !enemyKing) return false;
      return Math.max(Math.abs(destination.row - enemyKing.row), Math.abs(destination.col - enemyKing.col)) === 1;
    }

    function contactCheckDetect(givesCheck, destination, enemyKing) {
      if (!givesCheck || !enemyKing) return false;
      return Math.max(Math.abs(destination.row - enemyKing.row), Math.abs(destination.col - enemyKing.col)) <= 1;
    }

    function exchangeSacNearKing(piece, materialDelta, captured, destination, enemyKing) {
      if (!piece || piece.toLowerCase() !== 'r' || !enemyKing) return false;
      if (!captured || !['n', 'b'].includes(captured.toLowerCase())) return false;
      // Rook-for-knight/bishop is roughly -200cp; rook-for-bishop+pawn etc. can
      // be deeper. Accept up to a rook-for-a-major-minus, exclude trivial and
      // clearly-losing trades. materialDelta is in centipawns.
      if (materialDelta >= -120 || materialDelta <= -650) return false;
      return Math.max(Math.abs(destination.row - enemyKing.row), Math.abs(destination.col - enemyKing.col)) <= 2;
    }

    function kingChased(enemyKing, playerIsWhite) {
      if (!enemyKing) return false;
      return enemyKing.row !== (playerIsWhite ? 0 : 7);
    }

    function uncastledKingPunish(enemyKing, playerIsWhite, givesCheck, kingPressureDelta) {
      if (!enemyKing) return false;
      if (enemyKing.col !== 4) return false;
      if (enemyKing.row !== (playerIsWhite ? 0 : 7)) return false;
      return Boolean(givesCheck || kingPressureDelta > 0);
    }

    function rookLiftDetect(piece, from, to, playerIsWhite) {
      if (!piece || piece.toLowerCase() !== 'r') return false;
      const fromCoords = squareToCoords(from);
      const destCoords = squareToCoords(to);
      const isEnemyHalf = playerIsWhite ? destCoords.row <= 3 : destCoords.row >= 4;
      const advanced = playerIsWhite ? destCoords.row < fromCoords.row : destCoords.row > fromCoords.row;
      return isEnemyHalf && advanced;
    }

    // ── Kill-geometry primitives ───────────────────────────────────────
    function kingMobilityFrom(board, kingIsWhite) {
      const kingPos = findKing(board, kingIsWhite);
      if (!kingPos) return 0;
      let moves = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = kingPos.row + dr, c = kingPos.col + dc;
        if (r < 0 || r > 7 || c < 0 || c > 7) continue;
        const occ = board[r][c];
        if (occ && (occ === occ.toUpperCase()) === kingIsWhite) continue;
        if (isSquareAttacked(board, { row: r, col: c }, kingIsWhite ? 'b' : 'w')) continue;
        moves++;
      }
      return moves;
    }

    function detectSmothered(board, enemyKing, playerIsWhite) {
      if (!enemyKing) return false;
      const cornerRow = enemyKing.row === 0 || enemyKing.row === 7;
      const cornerCol = enemyKing.col === 0 || enemyKing.col === 7;
      if (!cornerRow || !cornerCol) return false;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = enemyKing.row + dr, c = enemyKing.col + dc;
        if (r < 0 || r > 7 || c < 0 || c > 7) continue;
        const occ = board[r][c];
        if (!occ || (occ === occ.toUpperCase()) === playerIsWhite) return false;
      }
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && (p === p.toUpperCase()) === playerIsWhite && p.toLowerCase() === 'n' &&
          pieceAttacksSquare(board, r, c, enemyKing.row, enemyKing.col)) return true;
      }
      return false;
    }

    function detectAnastasia(board, enemyKing, playerIsWhite, givesCheck) {
      if (!givesCheck || !enemyKing) return false;
      const backRow = playerIsWhite ? 0 : 7;
      if (enemyKing.row !== backRow || (enemyKing.col !== 0 && enemyKing.col !== 7)) return false;
      let fileChecker = false;
      for (let r = 0; r < 8; r++) {
        if (r === enemyKing.row) continue;
        const p = board[r][enemyKing.col];
        if (!p || (p === p.toUpperCase()) !== playerIsWhite) continue;
        if (['r', 'q'].includes(p.toLowerCase()) &&
          pieceAttacksSquare(board, r, enemyKing.col, enemyKing.row, enemyKing.col)) { fileChecker = true; break; }
      }
      if (!fileChecker) return false;
      const towardCenter = enemyKing.col === 0 ? 1 : -1;
      const rankFlight = { row: enemyKing.row, col: enemyKing.col + towardCenter };
      const diagFlight = { row: enemyKing.row + (playerIsWhite ? 1 : -1), col: enemyKing.col + towardCenter };
      let knightCoversRank = false;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && (p === p.toUpperCase()) === playerIsWhite && p.toLowerCase() === 'n' &&
          pieceAttacksSquare(board, r, c, rankFlight.row, rankFlight.col)) { knightCoversRank = true; break; }
      }
      if (!knightCoversRank) return false;
      return Boolean(board[diagFlight.row]?.[diagFlight.col] || isSquareAttacked(board, diagFlight, playerIsWhite));
    }

    function detectArabian(board, enemyKing, playerIsWhite, givesCheck) {
      if (!givesCheck || !enemyKing) return false;
      const backRow = playerIsWhite ? 0 : 7;
      if (enemyKing.row !== backRow || (enemyKing.col !== 0 && enemyKing.col !== 7)) return false;
      const towardCenter = enemyKing.col === 0 ? 1 : -1;
      const checkerSquare = { row: enemyKing.row, col: enemyKing.col + towardCenter };
      const checker = board[checkerSquare.row]?.[checkerSquare.col];
      if (!checker || (checker === checker.toUpperCase()) !== playerIsWhite) return false;
      if (!['r', 'q'].includes(checker.toLowerCase())) return false;
      if (!pieceAttacksSquare(board, checkerSquare.row, checkerSquare.col, enemyKing.row, enemyKing.col)) return false;
      const diagFlight = { row: enemyKing.row + (playerIsWhite ? 1 : -1), col: enemyKing.col + towardCenter };
      let knightCoversDiag = false;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && (p === p.toUpperCase()) === playerIsWhite && p.toLowerCase() === 'n' &&
          pieceAttacksSquare(board, r, c, diagFlight.row, diagFlight.col)) { knightCoversDiag = true; break; }
      }
      if (!knightCoversDiag) return false;
      const fileFlight = { row: enemyKing.row + (playerIsWhite ? 1 : -1), col: enemyKing.col };
      return Boolean(board[fileFlight.row]?.[fileFlight.col] || isSquareAttacked(board, fileFlight, playerIsWhite));
    }

    function detectBoden(board, enemyKing, playerIsWhite) {
      if (!enemyKing) return false;
      const homeRow = playerIsWhite ? 0 : 7;
      if (enemyKing.row !== homeRow || (enemyKing.col !== 6 && enemyKing.col !== 2)) return false;
      let bishops = 0;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && (p === p.toUpperCase()) === playerIsWhite && p.toLowerCase() === 'b' &&
          pieceAttacksSquare(board, r, c, enemyKing.row, enemyKing.col)) bishops++;
      }
      return bishops >= 2;
    }

    // ── Fast-kill geometry ─────────────────────────────────────────────
    // Corridor mate (Korridormatt): the enemy king is on its own back rank and
    // the rank in front is sealed by its own pawns/pieces, so the only flight
    // direction is along the back rank. Our rook/queen lands on that back rank
    // with a clear line to the king. The king may be on ANY file.
    function corridorMateDetect(board, after, destination, piece, enemyKing, playerIsWhite) {
      if (!enemyKing || !['r', 'q'].includes(piece.toLowerCase())) return false;
      const backRow = playerIsWhite ? 0 : 7;
      if (enemyKing.row !== backRow || destination.row !== backRow) return false;
      if (!pieceAttacksSquare(after, destination.row, destination.col, enemyKing.row, enemyKing.col)) return false;
      const fwdRow = playerIsWhite ? 1 : 6;
      for (const dc of [-1, 0, 1]) {
        const c = enemyKing.col + dc;
        if (c < 0 || c > 7) continue;
        const p = after[fwdRow]?.[c];
        if (!p || (p === p.toUpperCase()) === playerIsWhite) return false;
      }
      return true;
    }

    // EpauletteMate: a queen or rook lands to deliver a mate where the enemy
    // king is hemmed in on both sides by its own pieces on the same rank.
    function epauletteMateDetect(board, after, destination, enemyKing, playerIsWhite) {
      const arrived = after[destination.row]?.[destination.col];
      if (!enemyKing || !arrived || !['q', 'r'].includes(arrived.toLowerCase())) return false;
      if (enemyKing.row !== (playerIsWhite ? 0 : 7)) return false;
      if (!pieceAttacksSquare(after, destination.row, destination.col, enemyKing.row, enemyKing.col)) return false;
      const left = { row: enemyKing.row, col: enemyKing.col - 1 };
      const right = { row: enemyKing.row, col: enemyKing.col + 1 };
      if (left.col < 0 || right.col > 7) return false;
      const leftP = after[left.row]?.[left.col];
      const rightP = after[right.row]?.[right.col];
      const enemyOwn = p => p && (p === p.toUpperCase()) !== playerIsWhite && p.toLowerCase() !== 'k';
      if (!enemyOwn(leftP) || !enemyOwn(rightP)) return false;
      const diagDown = { row: enemyKing.row + (playerIsWhite ? 1 : -1), col: enemyKing.col };
      return Boolean(after[diagDown.row]?.[diagDown.col] ||
        isSquareAttacked(after, diagDown, playerIsWhite));
    }

    function undefendedDefenderHit(board, after, destination, piece, captured, playerIsWhite, enemyKing) {
      if (!enemyKing) return false;
      const near = (r, c) => Math.max(Math.abs(r - enemyKing.row), Math.abs(c - enemyKing.col)) <= 2;
      const undefended = (b, r, c, p) => {
        if (!p || (p === p.toUpperCase()) === playerIsWhite || p.toLowerCase() === 'k') return false;
        if (!near(r, c)) return false;
        return !isSquareAttacked(b, { row: r, col: c }, playerIsWhite ? 'b' : 'w');
      };
      if (captured && undefended(board, destination.row, destination.col, captured)) return true;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        if (!undefended(after, r, c, after[r][c])) continue;
        if (pieceAttacksSquare(after, destination.row, destination.col, r, c)) return true;
      }
      return false;
    }

    // ── Mating-square arithmetic ───────────────────────────────────────
    // `enemyInCheck`: when the enemy king is in check it usually cannot recapture
    // on the mating squares, so counting it as a defender inflates the defender
    // side and suppresses the very outnumber signal that matters most.
    function matingSquareBalance(board, playerIsWhite, enemyKing, enemyInCheck) {
      if (!enemyKing) return { outnumbered: 0, maxOutnumber: 0, totalBalance: 0 };
      let outnumbered = 0, maxOutnumber = 0, totalBalance = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = enemyKing.row + dr, c = enemyKing.col + dc;
        if (r < 0 || r > 7 || c < 0 || c > 7) continue;
        let attackers = 0, defenders = 0;
        if (!enemyInCheck && pieceAttacksSquare(board, enemyKing.row, enemyKing.col, r, c)) defenders++;
        for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
          const p = board[row][col];
          if (!p || p.toLowerCase() === 'k') continue;
          if (!pieceAttacksSquare(board, row, col, r, c)) continue;
          if ((p === p.toUpperCase()) === playerIsWhite) attackers++;
          else defenders++;
        }
        const balance = attackers - defenders;
        totalBalance += balance;
        if (attackers > 0 && balance > 0) outnumbered++;
        maxOutnumber = Math.max(maxOutnumber, balance);
      }
      return { outnumbered, maxOutnumber, totalBalance };
    }

    // ── Position-level exploitation ────────────────────────────────────
    function positionalHangingHit(after, destination, captured, playerIsWhite) {
      if (captured && captured.toLowerCase() !== 'k') {
        const capturedIsWhite = captured === captured.toUpperCase();
        if (capturedIsWhite !== playerIsWhite && !isSquareAttacked(after, destination, playerIsWhite ? 'b' : 'w')) return true;
      }
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = after[r][c];
        if (!p || (p === p.toUpperCase()) === playerIsWhite || p.toLowerCase() === 'k') continue;
        if (isSquareAttacked(after, { row: r, col: c }, playerIsWhite ? 'b' : 'w')) continue;
        if (pieceAttacksSquare(after, destination.row, destination.col, r, c)) return true;
      }
      return false;
    }

    function backRankFragility(after, opponentKingData, playerIsWhite) {
      if (!opponentKingData) return false;
      const backRow = playerIsWhite ? 0 : 7;
      if (opponentKingData.row !== backRow) return false;
      const forwardRow = playerIsWhite ? 1 : 6;
      const forwardPawn = after[forwardRow]?.[opponentKingData.col];
      const pawnShieldHome = Boolean(forwardPawn) &&
        (forwardPawn === forwardPawn.toUpperCase()) !== playerIsWhite &&
        forwardPawn.toLowerCase() === 'p';
      if (!pawnShieldHome) return false;
      let blockedSide = 0;
      for (const dc of [-1, 1]) {
        const c = opponentKingData.col + dc;
        if (c < 0 || c > 7) { blockedSide++; continue; }
        const p = after[backRow][c];
        if (p && (p === p.toUpperCase()) !== playerIsWhite) blockedSide++;
      }
      return blockedSide >= 1;
    }

    // ── Opening strikes ────────────────────────────────────────────────
    function scholarTrapSetup(board, after, piece, destination, playerIsWhite, opponentKingData) {
      if (!opponentKingData || piece.toLowerCase() !== 'q') return false;
      if (opponentKingData.row !== (playerIsWhite ? 0 : 7) || opponentKingData.col !== 4) return false;
      const shield = { row: playerIsWhite ? 1 : 6, col: 5 };
      const shieldPawn = board[shield.row]?.[shield.col];
      if (!shieldPawn || (shieldPawn === shieldPawn.toUpperCase()) === playerIsWhite || shieldPawn.toLowerCase() !== 'p') return false;
      const bishopPos = { row: playerIsWhite ? 4 : 3, col: 2 };
      const bishop = board[bishopPos.row]?.[bishopPos.col];
      if (!bishop || (bishop === bishop.toUpperCase()) !== playerIsWhite || bishop.toLowerCase() !== 'b') return false;
      if (!pieceAttacksSquare(board, bishopPos.row, bishopPos.col, shield.row, shield.col)) return false;
      if (destination.row === shield.row && destination.col === shield.col) return true;
      return pieceAttacksSquare(after, destination.row, destination.col, shield.row, shield.col);
    }

    function legalsTrapSetup(board, after, piece, destination, playerIsWhite, opponentKingData) {
      if (!opponentKingData || piece.toLowerCase() !== 'n') return false;
      if (opponentKingData.row !== (playerIsWhite ? 0 : 7) || opponentKingData.col !== 4) return false;
      if (destination.row !== (playerIsWhite ? 3 : 4) || destination.col !== 4) return false;
      const bishopPos = { row: playerIsWhite ? 4 : 3, col: 2 };
      const bishop = board[bishopPos.row]?.[bishopPos.col];
      if (!bishop || (bishop === bishop.toUpperCase()) !== playerIsWhite || bishop.toLowerCase() !== 'b') return false;
      const shield = { row: playerIsWhite ? 1 : 6, col: 5 };
      return pieceAttacksSquare(after, bishopPos.row, bishopPos.col, shield.row, shield.col);
    }

    function laskerTrapDetect(board, after, piece, destination, playerIsWhite, opponentKingData, givesCheck) {
      if (!opponentKingData || piece.toLowerCase() !== 'p' || !givesCheck) return false;
      if (opponentKingData.row !== (playerIsWhite ? 0 : 7) || opponentKingData.col !== 4) return false;
      return destination.row === (playerIsWhite ? 1 : 6) && destination.col === 5;
    }

    // ── Tactical toolkit ───────────────────────────────────────────────
    function pieceBeyond(board, row, col, targetRow, targetCol) {
      const dr = Math.sign(targetRow - row), dc = Math.sign(targetCol - col);
      if (dr === 0 && dc === 0) return null;
      let r = targetRow + dr, c = targetCol + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const p = board[r][c];
        if (p) return { piece: p, row: r, col: c };
        r += dr; c += dc;
      }
      return null;
    }

    function knightForkDetect(after, destination, playerIsWhite) {
      const mover = after[destination.row]?.[destination.col];
      if (!mover || (mover === mover.toUpperCase()) !== playerIsWhite || mover.toLowerCase() !== 'n') {
        return { count: 0, royal: false };
      }
      const targets = [];
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = after[r][c];
        if (!p || (p === p.toUpperCase()) === playerIsWhite) continue;
        if (pieceAttacksSquare(after, destination.row, destination.col, r, c)) targets.push(p.toLowerCase());
      }
      if (targets.length < 2) return { count: targets.length, royal: false };
      return { count: targets.length, royal: targets.includes('k') };
    }

    function pinDetection(after, destination, playerIsWhite) {
      const mover = after[destination.row]?.[destination.col];
      if (!mover || (mover === mover.toUpperCase()) !== playerIsWhite || !['b', 'r', 'q'].includes(mover.toLowerCase())) {
        return { pinToKing: false, pinToQueen: false };
      }
      let pinToKing = false, pinToQueen = false;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = after[r][c];
        if (!p || (p === p.toUpperCase()) === playerIsWhite || p.toLowerCase() === 'k') continue;
        if (!pieceAttacksSquare(after, destination.row, destination.col, r, c)) continue;
        const behind = pieceBeyond(after, destination.row, destination.col, r, c);
        if (!behind) continue;
        if (behind.piece.toLowerCase() === 'k') pinToKing = true;
        else if (behind.piece.toLowerCase() === 'q') pinToQueen = true;
      }
      return { pinToKing, pinToQueen };
    }

    function skewerDetection(after, destination, playerIsWhite, enemyKingData) {
      const mover = after[destination.row]?.[destination.col];
      if (!mover || (mover === mover.toUpperCase()) !== playerIsWhite || !['b', 'r', 'q'].includes(mover.toLowerCase())) {
        return { count: 0 };
      }
      let count = 0;
      if (enemyKingData && pieceAttacksSquare(after, destination.row, destination.col, enemyKingData.row, enemyKingData.col)) {
        const behind = pieceBeyond(after, destination.row, destination.col, enemyKingData.row, enemyKingData.col);
        if (behind && (behind.piece === behind.piece.toUpperCase()) !== playerIsWhite) count++;
      }
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = after[r][c];
        if (!p || (p === p.toUpperCase()) === playerIsWhite || p.toLowerCase() === 'k') continue;
        if (!pieceAttacksSquare(after, destination.row, destination.col, r, c)) continue;
        const behind = pieceBeyond(after, destination.row, destination.col, r, c);
        if (behind && (behind.piece === behind.piece.toUpperCase()) !== playerIsWhite) count++;
      }
      return { count };
    }

    function discoveredAttack(board, after, destination, playerIsWhite) {
      const valuable = p => p && ['n', 'b', 'r', 'q', 'k'].includes(p.toLowerCase());
      const attackedTargets = (b, excludePos) => {
        const hits = new Set();
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
          const p = b[r][c];
          if (!p || (p === p.toUpperCase()) !== playerIsWhite) continue;
          if (excludePos && r === excludePos.row && c === excludePos.col) continue;
          if (!['b', 'r', 'q'].includes(p.toLowerCase())) continue;
          for (let tr = 0; tr < 8; tr++) for (let tc = 0; tc < 8; tc++) {
            const t = b[tr][tc];
            if (!t || (t === t.toUpperCase()) === playerIsWhite || !valuable(t)) continue;
            if (pieceAttacksSquare(b, r, c, tr, tc)) hits.add(`${tr},${tc}`);
          }
        }
        return hits;
      };
      const before = attackedTargets(board, null);
      const afterTargets = attackedTargets(after, destination);
      const revealed = [...afterTargets].filter(key => !before.has(key));
      if (revealed.length === 0) return { discovered: false, discoveredCheck: false };
      const checkTarget = revealed.some(key => {
        const [r, c] = key.split(',').map(Number);
        return after[r][c] && after[r][c].toLowerCase() === 'k';
      });
      return { discovered: true, discoveredCheck: checkTarget };
    }

    function endgameCoup(fen, piece, destination, playerIsWhite, ownKingBefore, ownKingAfter, opponentKingAfter, givesCheck, captured) {
      if (detectGamePhase(fen) !== 'endgame') return false;
      if (givesCheck || captured) return true;
      const type = piece.toLowerCase();
      if (type === 'k' && ownKingBefore && opponentKingAfter) {
        const before = Math.max(Math.abs(ownKingBefore.row - opponentKingAfter.row), Math.abs(ownKingBefore.col - opponentKingAfter.col));
        const distance = Math.max(Math.abs(destination.row - opponentKingAfter.row), Math.abs(destination.col - opponentKingAfter.col));
        if (distance < before) return true;
      }
      if (['r', 'q'].includes(type)) {
        if (playerIsWhite ? destination.row === 1 : destination.row === 6) return true;
      }
      return false;
    }

    // ── Fast-kill gesture: windmill ────────────────────────────────────
    // A discovered check combined with a follow-up check from the revealer:
    // stepping a piece off a slider's line gives check and the hiding slider
    // (rook/bishop/queen) itself delivers a recurring check if the screened
    // piece is forced off — the classic check-recapture-recheck windmill that
    // gathers wood for free. We approximate it as a discovered check that also
    // re-checks within the PV line.
    function windmillDetect(board, after, destination, playerIsWhite, enemyKing, givesCheck, line, fen, playerColor) {
      if (!givesCheck || !enemyKing) return false;
      const disc = discoveredAttack(board, after, destination, playerIsWhite);
      if (!disc.discoveredCheck) return false;
      let cur = after;
      let curFen = applyMoveToFen(fen, line[0]);
      for (let i = 1; i < line.length; i++) {
        const move = line[i];
        if (!move || move.length < 4) continue;
        cur = applyMoveToBoard(cur, move);
        const mover = (curFen.split(' ')[1] || 'w');
        const nextKing = findKing(cur, mover === 'w' ? false : true);
        const reChecks = nextKing ? isSquareAttacked(cur, nextKing, mover) : false;
        if (mover === playerColor && reChecks) return true;
        curFen = applyMoveToFen(curFen, move);
      }
      return false;
    }

    // ── Fast-kill gesture: queen sacrifice for a charge ───────────────
    // Only a genuine queen sac counts: the move is inside a forced-mate net,
    // or the queen lands where a cheaper enemy piece can take it, or the
    // material concession really is ~a queen (>= 900 centipawns). materialDelta
    // is in centipawns (hint-engine PIECE_VALUES * 100).
    function queenSacForCharge(after, piece, destination, materialDelta, forcedMateNet, playerIsWhite) {
      if (!piece || piece.toLowerCase() !== 'q') return false;
      if (forcedMateNet) return true;
      if (materialDelta <= -900) return true;
      if (!after || !destination) return false;
      const takers = ['p', 'n', 'b', 'r'];
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = after[r][c];
        if (!p || (p === p.toUpperCase()) === playerIsWhite) continue;
        if (!takers.includes(p.toLowerCase())) continue;
        if (pieceAttacksSquare(after, r, c, destination.row, destination.col)) return true;
      }
      return false;
    }

    // ── V2 strategic layer ─────────────────────────────────────────────
    // Classify WHY a sacrifice works. A real attacker's sacrifice states its
    // mechanism: it deflects the key defender, rips open the cover, or keeps
    // the initiative with check — and shows concrete follow-up. A material
    // drop with none of these is not fearless, it is unexplained.
    function classifySacMechanism(ctx) {
      const { board, after, captured, destination, materialDelta, playerIsWhite,
        opponentKingBefore, givesCheck, line } = ctx;
      if (!Number.isFinite(materialDelta) || materialDelta > -150) return null;
      const openedLine = pawnShieldStrike(captured, destination, opponentKingBefore) ||
        discoveredAttack(board, after, destination, playerIsWhite).discovered;
      let deflectedKeyDefender = false;
      if (captured && opponentKingBefore) {
        const dist = Math.max(
          Math.abs(destination.row - opponentKingBefore.row),
          Math.abs(destination.col - opponentKingBefore.col));
        deflectedKeyDefender = dist <= 2;
      }
      const hasFollowUp = Array.isArray(line) && line.length >= 3;
      if (openedLine && (hasFollowUp || givesCheck)) return 'lineOpen';
      if (deflectedKeyDefender && hasFollowUp) return 'deflect';
      if (givesCheck && hasFollowUp) return 'tempo';
      return null;
    }

    // Zero-freedom initiative: fraction of the defender's plies in the PV
    // that are king moves or recaptures (i.e., forced). 1.0 means the
    // defender never gets a free move in the whole calculated line.
    function measureInitiativeFreedom(startBoard, line, startFen, playerColor) {
      let defenderPlies = 0, forcedPlies = 0;
      let scanBoard = startBoard, scanFen = startFen;
      for (const move of (line || [])) {
        if (!move || move.length < 4) continue;
        const mover = (scanFen.split(' ')[1] || 'w');
        const wasCapture = Boolean(getPieceAt(scanBoard, move.slice(2, 4)));
        const movingPiece = (getPieceAt(scanBoard, move.slice(0, 2)) || '').toLowerCase();
        if (mover !== playerColor) {
          defenderPlies++;
          if (movingPiece === 'k' || wasCapture) forcedPlies++;
        }
        scanBoard = applyMoveToBoard(scanBoard, move);
        scanFen = applyMoveToFen(scanFen, move);
      }
      return defenderPlies > 0 ? forcedPlies / defenderPlies : 0;
    }

    // Quiet attacking prep: the between-blows moves real strong attackers
    // play — tuck the king, swing the last rook to the open file, gain space
    // with a pawn wedge — recognized as FIRST-CLASS attacking moves.
    function classifyQuietPrep(ctx) {
      const { fen, after, piece, destination, givesCheck, captured, playerIsWhite,
        opponentKingAfter, ownKingAfter, pressureDelta } = ctx;
      if (givesCheck || captured) return null;
      if (!piece || !destination) return null;
      if (detectGamePhase(fen) === 'endgame') return null;
      const type = piece.toLowerCase();
      if (type === 'k' && ownKingAfter) {
        const shelterRows = playerIsWhite ? [7, 6] : [0, 1];
        if (shelterRows.includes(destination.row) && pressureDelta >= 0) return 'kingSafety';
      }
      if (type === 'r' && opponentKingAfter) {
        const col = destination.col;
        let pawnsOnFile = 0;
        for (let r = 0; r < 8; r++) {
          const p = after[r][col];
          if (p === 'P' || p === 'p') pawnsOnFile++;
        }
        if (pawnsOnFile === 0 && Math.abs(col - opponentKingAfter.col) <= 2) return 'rookFile';
      }
      if (type === 'p' && opponentKingAfter) {
        const manhattan = Math.abs(destination.row - opponentKingAfter.row) +
          Math.abs(destination.col - opponentKingAfter.col);
        if (manhattan <= 4 && pressureDelta >= 0) return 'pawnWedge';
      }
      return null;
    }

    // ── Per-move feature computation ──────────────────────────────────
    // Replicates the delta block that used to live inside the host's
    // `analyzeCandidate`, producing a flat feature blob the host merges in.
    function computeFeatures(ctx) {
      const {
        fen, board, after, piece, captured, from, to, destination, playerIsWhite, playerColor,
        opponentKingBefore, opponentKingAfter, ownKingBefore, ownKingAfter, givesCheck,
        materialDelta, line, boardAfterReply, scoreType, rawScore, pressureBefore, pressureAfter
      } = ctx;

      // Cage / shield / hunt
      const cageBefore = kingCageCoverage(board, playerIsWhite, opponentKingBefore);
      const cageAfter = kingCageCoverage(after, playerIsWhite, opponentKingAfter);
      const kingCageDelta = cageAfter - cageBefore;
      let maxCage = 8;
      if (opponentKingAfter) {
        maxCage = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const tr = opponentKingAfter.row + dr, tc = opponentKingAfter.col + dc;
          if (tr >= 0 && tr <= 7 && tc >= 0 && tc <= 7) maxCage++;
        }
      }
      const kingSuffocation = givesCheck && cageAfter >= maxCage;
      const backRank = backRankThreat(after, opponentKingAfter, destination, playerIsWhite);
      const shieldStrike = pawnShieldStrike(captured, destination, opponentKingBefore);
      const contact = contactCheckDetect(givesCheck, destination, opponentKingAfter);
      const exchangeSac = exchangeSacNearKing(piece, materialDelta, captured, destination, opponentKingBefore);
      const chased = kingChased(opponentKingBefore, playerIsWhite);
      const punishUncastled = uncastledKingPunish(opponentKingBefore, playerIsWhite, givesCheck,
        (pressureAfter.pressure - pressureBefore.pressure));
      const rookLiftMove = rookLiftDetect(piece, from, to, playerIsWhite);

      // Kill geometry
      const mobilityBefore = kingMobilityFrom(board, !playerIsWhite);
      const mobilityAfter = kingMobilityFrom(after, !playerIsWhite);
      const kingMobilityDelta = mobilityBefore - mobilityAfter;
      const smotheredMate = detectSmothered(after, opponentKingAfter, playerIsWhite);
      const anastasiaMate = detectAnastasia(after, opponentKingAfter, playerIsWhite, givesCheck);
      const arabianMate = detectArabian(after, opponentKingAfter, playerIsWhite, givesCheck);
      const bodenMate = detectBoden(after, opponentKingAfter, playerIsWhite);

      let consecutiveOurChecks = 0, maxOurChecks = 0;
      let mateNetFen = fen, mateNetBoard = board;
      for (const move of line) {
        const nextBoard = applyMoveToBoard(mateNetBoard, move);
        const mover = (mateNetFen.split(' ')[1] || 'w');
        const foeKing = findKing(nextBoard, mover === 'w' ? false : true);
        const moverChecks = foeKing ? isSquareAttacked(nextBoard, foeKing, mover) : false;
        if (mover === playerColor) {
          if (moverChecks) { consecutiveOurChecks++; maxOurChecks = Math.max(maxOurChecks, consecutiveOurChecks); }
          else consecutiveOurChecks = 0;
        }
        mateNetBoard = nextBoard;
        mateNetFen = applyMoveToFen(mateNetFen, move);
      }
      const forcedMateNet = scoreType === 'mate' && rawScore > 0 && givesCheck && maxOurChecks >= 2;
      const undefendedHit = undefendedDefenderHit(board, after, destination, piece, captured, playerIsWhite, opponentKingAfter);

      // Mating-square arithmetic
      const enemyInCheckAfter = opponentKingAfter ? isSquareAttacked(after, opponentKingAfter, playerColor) : false;
      const mateMathBefore = matingSquareBalance(board, playerIsWhite, opponentKingBefore, false);
      const mateMathAfter = matingSquareBalance(after, playerIsWhite, opponentKingAfter, enemyInCheckAfter);
      const squareOutnumberDelta = mateMathAfter.outnumbered - mateMathBefore.outnumbered;

      // Position-level exploitation
      const hangingPieceGrab = positionalHangingHit(after, destination, captured, playerIsWhite);
      const fragileBackRank = backRankFragility(after, opponentKingAfter, playerIsWhite);
      const backRankExploit = fragileBackRank && ['r', 'q'].includes(piece.toLowerCase()) && opponentKingAfter
        ? (destination.row === opponentKingAfter.row ||
          pieceAttacksSquare(after, destination.row, destination.col, opponentKingAfter.row, opponentKingAfter.col))
        : false;

      // Opening traps
      const scholarTrap = scholarTrapSetup(board, after, piece, destination, playerIsWhite, opponentKingAfter);
      const legalsTrap = legalsTrapSetup(board, after, piece, destination, playerIsWhite, opponentKingAfter);
      const laskerTrapMove = laskerTrapDetect(board, after, piece, destination, playerIsWhite, opponentKingAfter, givesCheck);

      // Second-move vision
      let followUpCheck = false, followUpFork = false, followUpCapture = false, followUpCageStep = false;
      if (line.length >= 3 && boardAfterReply) {
        const followMove = line[2];
        const followPiece = getPieceAt(boardAfterReply, followMove.slice(0, 2));
        if (followPiece && (followPiece === followPiece.toUpperCase()) === playerIsWhite) {
          const followBoard = applyMoveToBoard(boardAfterReply, followMove);
          const followKing = findKing(followBoard, !playerIsWhite);
          followUpCheck = followKing ? isSquareAttacked(followBoard, followKing, playerColor) : false;
          followUpCapture = Boolean(getPieceAt(boardAfterReply, followMove.slice(2, 4)));
          followUpFork = multiThreatCount(followBoard, followMove.slice(2, 4), playerIsWhite) > 1;
          const kingBefore = findKing(boardAfterReply, !playerIsWhite);
          const cageBefore = kingCageCoverage(boardAfterReply, playerIsWhite, kingBefore);
          const cageAfter = kingCageCoverage(followBoard, playerIsWhite, followKing);
          followUpCageStep = cageAfter > cageBefore;
        }
      }
      const followUpVision = followUpCheck || followUpFork || followUpCapture || followUpCageStep;

      // Tactical toolkit
      const forkInfo = knightForkDetect(after, destination, playerIsWhite);
      const pinInfo = pinDetection(after, destination, playerIsWhite);
      const skewerInfo = skewerDetection(after, destination, playerIsWhite, opponentKingAfter);
      const discInfo = discoveredAttack(board, after, destination, playerIsWhite);
      const endgame = endgameCoup(fen, piece, destination, playerIsWhite, ownKingBefore, ownKingAfter, opponentKingAfter, givesCheck, captured);

      // Fast-kill geometry & pressure scalars
      const corridorMate = corridorMateDetect(board, after, destination, piece, opponentKingAfter, playerIsWhite);
      const epauletteMate = epauletteMateDetect(board, after, destination, opponentKingAfter, playerIsWhite);
      const windmill = windmillDetect(board, after, destination, playerIsWhite, opponentKingAfter, givesCheck, line, fen, playerColor);
      const queenSac = queenSacForCharge(after, piece, destination, materialDelta, forcedMateNet, playerIsWhite);

      // V2 strategic layer
      const sacMechanism = classifySacMechanism({
        board, after, captured, destination, materialDelta, playerIsWhite,
        opponentKingBefore, givesCheck, line
      });
      const defenderForcedRatio = measureInitiativeFreedom(board, line, fen, playerColor);
      const quietPrepKind = classifyQuietPrep({
        fen, after, piece, destination, givesCheck, captured, playerIsWhite,
        opponentKingAfter, ownKingAfter,
        pressureDelta: pressureAfter.pressure - pressureBefore.pressure
      });
      // Pressure sustained across the PV: fraction of our plies that deliver a
      // check or sit within a forced-mate chain — the higher, the closer to a
      // kill. Only meaningful when the line keeps driving at the king.
      let checkedPlies = 0, totalOurPlies = 0;
      let scanFen = fen, scanBoard = board;
      for (const move of line) {
        const nextBoard = applyMoveToBoard(scanBoard, move);
        const mover = (scanFen.split(' ')[1] || 'w');
        if (mover === playerColor) {
          totalOurPlies++;
          const foeKing = findKing(nextBoard, mover === 'w' ? false : true);
          const foeHasKing = foeKing;
          const moverChecks = foeHasKing ? isSquareAttacked(nextBoard, foeKing, mover) : false;
          if (moverChecks) checkedPlies++;
        }
        scanBoard = nextBoard;
        scanFen = applyMoveToFen(scanFen, move);
      }
      const sustainedPressure = totalOurPlies > 0 ? (checkedPlies / totalOurPlies) : 0;
      const zeroFreedom = defenderForcedRatio >= 0.99 && totalOurPlies >= 2;
      // Speed scalar: reward how early a mate/closing reaches ply 1 with a
      // mate line; else gently prefer fewer plies to the target.
      let mateSpeed = 0;
      if (scoreType === 'mate' && givesCheck) {
        mateSpeed = Math.max(0, 8 - Math.min(8, line.length || 1)) / 8;
      } else if (forcedMateNet && rawScore > 0) {
        mateSpeed = 0.5;
      }
      // Narrow-escape scalar: our check that leaves the enemy king with fewer
      // or zero escape squares (slam shut on a near-compressed king).
      const narrowEscape = givesCheck && opponentKingAfter
        ? Math.max(0, mobilityBefore - mobilityAfter) > 0 || mobilityAfter === 0
        : false;
      // Attacker-trade penalty: on a forcing line, if we drop one of our own
      // major attackers AND the attack loses momentum (pressure stalls), temper
      // the raw aggression. A check while materially down that keeps the attack
      // going is a sound sacrifice and must NOT be penalized.
      const attackerTradeOff = givesCheck && materialDelta <= -10 && sustainedPressure < 0.4;

      // Self-safety hard gate
      const ownEscapesAfter = kingMobilityFrom(after, playerIsWhite);
      const ownKingTrapped = !givesCheck && ownEscapesAfter === 0 && !(scoreType === 'mate' && rawScore > 0);

      return {
        kingCageDelta,
        kingCageAfter: cageAfter,
        kingSuffocation: kingSuffocation,
        backRank,
        shieldStrike,
        contactCheck: contact,
        exchangeSac,
        chased,
        punishUncastled: punishUncastled,
        rookLiftMove: rookLiftMove,
        kingMobilityBefore: mobilityBefore,
        kingMobilityAfter: mobilityAfter,
        kingMobilityDelta,
        smotheredMate,
        anastasiaMate,
        arabianMate,
        bodenMate,
        forcedMateNet,
        undefendedHit,
        squareOutnumber: mateMathAfter.outnumbered,
        squareOutnumberDelta,
        maxSquareOutnumber: mateMathAfter.maxOutnumber,
        mateMathBalance: mateMathAfter.totalBalance,
        hangingPieceGrab,
        backRankExploit,
        backRankFragile: fragileBackRank,
        scholarTrap,
        legalsTrap,
        laskerTrap: laskerTrapMove,
        followUpVision,
        followUpCheck,
        followUpFork,
        followUpCapture,
        followUpCageStep,
        knightForkMove: forkInfo.count >= 2,
        knightForkCount: forkInfo.count,
        royalFork: forkInfo.royal,
        pinToKing: pinInfo.pinToKing,
        pinToQueen: pinInfo.pinToQueen,
        skewerCount: skewerInfo.count,
        discoveredAttack: discInfo.discovered,
        discoveredCheck: discInfo.discoveredCheck,
        endgameCoup: endgame,
        corridorMate,
        epauletteMate,
        windmill,
        queenSac,
        sacMechanism,
        defenderForcedRatio,
        zeroFreedom,
        quietPrepKind,
        sustainedPressure,
        mateSpeed,
        narrowEscape,
        attackerTradeOff,
        ownEscapesAfter,
        ownKingTrapped
      };
    }

    // ── Style bonus (phase-ordered additive clauses) ──────────────────
    function styleBonus(candidate, weights) {
      let amount = 0;
      const add = (condition, key, value, reason) => {
        if (!condition || !value) return;
        amount += value;
        if (value > 0 && reason) candidate.reasons.push(reason);
        if (value < 0 && reason) candidate.risks.push(reason);
      };

      // A1 — Attack Unit System (S-curve on king-zone attacker quality)
      if (candidate.attackUnitDelta > 0) {
        const after = candidate.attackUnits;
        const before = after - candidate.attackUnitDelta;
        const sBonus = attackUnitsToBonus(after) - attackUnitsToBonus(before);
        add(sBonus > 0, 'attackUnits', weights.attackUnits * Math.min(sBonus, 4), 'swarms the king zone with high-value attackers');
      }
      add(candidate.practicalChancesScore > 0, 'practicalChances', weights.practicalChances * Math.min(candidate.practicalChancesScore, 4), 'out-numbers the defenders in the enemy king zone');
      add(candidate.structuralComplexity !== 0, 'complexityStructural',
        weights.complexityStructural * Math.min(Math.abs(candidate.structuralComplexity), 3) * Math.sign(candidate.structuralComplexity),
        candidate.structuralComplexity > 0 ? 'raises the structural complexity with a sacrifice or central push' : 'squanders complexity with an even minor/rook trade');
      add(candidate.isGreekGift, 'greekGift', weights.greekGift, 'delivers the classic Greek gift on h7/h2');
      add(candidate.drawContemptScore < 0, 'drawContempt',
        weights.drawContempt * Math.max(-2, Math.min(candidate.drawContemptScore, 0)), 'rejects a near-equal calm position');
      add(candidate.overloadScore > 0, 'overload', weights.overload * Math.min(candidate.overloadScore, 2), 'exploits overloaded defenders near the king');

      // Cage family
      add(candidate.kingCageDelta > 0, 'kingCage', weights.kingCage * Math.min(candidate.kingCageDelta, 3), 'tightens the cage around the enemy king');
      add(candidate.kingSuffocation, 'kingSuffocation', weights.kingSuffocation, 'locks the king in a suffocating mating net');
      add(candidate.backRank, 'backRank', weights.backRank, 'threatens the king along its exposed back rank');
      add(candidate.shieldStrike, 'shieldStrike', weights.shieldStrike, 'rips the pawn shield off the castled king');
      add(candidate.contactCheck, 'contactCheck', weights.contactCheck, 'delivers a contact check that cannot be blocked');
      add(candidate.exchangeSac, 'exchangeSac', weights.exchangeSac, 'trades a rook for a knight/pawn at the king\'s doorstep');
      add(candidate.chased && candidate.kingPressureDelta > 0, 'kingChase', weights.kingChase, 'continues the hunt of the exposed king');
      add(candidate.punishUncastled, 'punishUncastled', weights.punishUncastled, 'punishes the king left in the centre');
      add(candidate.rookLiftMove, 'rookLift', weights.rookLift, 'lifts the rook toward the attack zone');

      // Kill-geometry mates
      add(candidate.kingMobilityDelta > 0, 'kingMobility', weights.kingMobility * Math.min(candidate.kingMobilityDelta, 4), 'further traps the enemy king');
      add(candidate.smotheredMate, 'smotheredMate', weights.smotheredMate, 'smothers the king with its own pieces');
      add(candidate.anastasiaMate, 'anastasiaMate', weights.anastasiaMate, 'sets up the Anastasia mate on the corner file');
      add(candidate.arabianMate, 'arabianMate', weights.arabianMate, 'sets up the Arabian mate in the corner');
      add(candidate.bodenMate, 'bodenMate', weights.bodenMate, 'criss-crosses the bishops for a Boden mate');
      add(candidate.forcedMateNet, 'forcedMateNet', weights.forcedMateNet, 'starts a forced mate sequence');
      add(candidate.undefendedHit, 'undefendedHit', weights.undefendedHit, 'pounces on an undefended defender of the king');

      // Mating math
      add(candidate.maxSquareOutnumber >= 2, 'matingMath', weights.matingMath * Math.min(candidate.maxSquareOutnumber - 1, 3), 'outnumbers the defenders on a mating square by force');
      add(candidate.squareOutnumberDelta > 0, 'squareOutnumber', weights.squareOutnumber * Math.min(candidate.squareOutnumberDelta, 2), 'creates a mating square where attackers outnumber defenders');
      add(candidate.exchangeSac && candidate.maxSquareOutnumber >= 1, 'matingMath', weights.matingMath, 'the exchange sacrifice is sound — attackers outnumber the king\'s defenders on the mating square');

      // Position-level
      add(candidate.hangingPieceGrab, 'hangingPieceGrab', weights.hangingPieceGrab, 'snaps up a piece the opponent left undefended');
      add(candidate.backRankExploit, 'backRankExploit', weights.backRankExploit, 'hammers the cramped back rank with the rook');

      // Opening traps
      add(candidate.scholarTrap, 'scholarTrap', weights.scholarTrap, 'lays the Scholar\'s mate net on the f-pawn');
      add(candidate.legalsTrap, 'legalsTrap', weights.legalsTrap, 'springs the Legal\'s mate net on e5');
      add(candidate.laskerTrap, 'laskerTrap', weights.laskerTrap, 'springs the Lasker trap on the king\'s rank');

      // Second-move vision
      add(candidate.followUpVision, 'followUpVision', weights.followUpVision,
        candidate.followUpCheck ? 'the follow-up keeps checking'
          : candidate.followUpFork ? 'the follow-up forks two major pieces'
          : candidate.followUpCageStep ? 'the follow-up tightens the cage'
          : 'the follow-up lands a second capture');

      // Tactical toolkit
      add(candidate.knightForkMove, 'knightFork',
        weights.knightFork * (candidate.royalFork ? 1.6 : Math.min(candidate.knightForkCount - 1, 2)),
        candidate.royalFork ? 'forks the king and a second piece with the knight'
          : `forks ${candidate.knightForkCount} enemy pieces with the knight`);
      add(candidate.pinToKing, 'pin', weights.pin, 'pins a piece to the enemy king');
      add(candidate.pinToQueen, 'pin', weights.pin, 'pins a piece to the enemy queen');
      add(candidate.skewerCount > 0, 'skewer', weights.skewer * Math.min(candidate.skewerCount, 2),
        candidate.skewerCount > 1 ? 'skewers two pieces on the same line' : 'skewers the king or queen to the piece behind');
      add(candidate.discoveredAttack, 'discoveredAttack', weights.discoveredAttack,
        candidate.discoveredCheck ? 'unveils a discovered check' : 'unveils a discovered attack');
      add(candidate.endgameCoup, 'endgameCoup', weights.endgameCoup, 'exploits the endgame blind spot');

      // Fast-finish aggression: an aggressive early queen that
      // immediately creates concrete pressure, and any path that finishes the
      // game sooner (forcing ply, opening lines, king attack).
      add(candidate.earlyQueenMove && (candidate.givesCheck || candidate.kingPressureDelta > 0 || candidate.tempoThreatCount > 0),
        'earlyQueen', weights.earlyQueen, 'throws the queen out early to build instant pressure');
      add(candidate.givesCheck && candidate.kingPressureDelta > 0, 'quickPressure',
        weights.quickPressure, 'creates immediate fast pressure on the king');
      add(candidate.forcingPly >= 2 || candidate.winningMate || (candidate.opensKingFile && candidate.givesCheck),
        'fastFinish', weights.fastFinish, 'finishes the game early with direct pressure');

      // Fast-kill aggression
      add(candidate.mateSpeed > 0, 'mateSpeed', weights.mateSpeed * candidate.mateSpeed, 'KOs the king as fast as the position allows');
      add(candidate.narrowEscape, 'narrowEscape', weights.narrowEscape, 'slams shut the king\'s last escape route');
      add(candidate.corridorMate, 'corridorMate', weights.corridorMate, 'delivers the corridor mate along the edge');
      add(candidate.epauletteMate, 'epauletteMate', weights.epauletteMate, 'hemig the king in for the epaulette mate');
      add(candidate.windmill, 'windmillAttack', weights.windmillAttack, 'starts the windmill — check after check, gathering wood free');
      add(candidate.queenSac, 'queenSacForCharge', weights.queenSacForCharge, 'slams the queen down to crash the defense for a win');
      add(candidate.sustainedPressure > 0.65, 'sustainedPressure',
        weights.sustainedPressure * Math.min(2, (candidate.sustainedPressure - 0.65) * 10 + 1),
        'keeps checking and pressing until the position breaks');
      // Urgency tax: a sustained attack that will run out of steam soon should
      // be pushed now, so mid-line pauses get a small negative.
      add((candidate.forcingPly >= 2 || candidate.givesCheck) && candidate.sustainedPressure < 0.4,
        'urgencyTax', weights.urgencyTax, 'the attack must land now — no time to dawdle');
      add(candidate.attackerTradeOff, 'attackerTradePenalty', weights.attackerTradePenalty,
        'bargains away an attacker for a mere tempo');

      // ── V2 strategic layer ───────────────────────────────────────────
      // Siege continuity: advancing the SAME plan as the previous pick is
      // worth real points; a coherent siege beats greedy per-move re-picking.
      if (candidate.siegeContinuity === true) {
        const continuityScale = Math.min(1.5, 0.6 + (Number(candidate.attackMomentum) || 0) * 0.15);
        add(true, 'siegeContinuity', weights.siegeContinuity * continuityScale,
          `advances the same plan — the ${candidate.plan || 'attack'} siege continues`);
      }
      // Sacrifice mechanism classification. Sound mechanisms earn their
      // weight; an unexplained material drop is penalized even here.
      if (candidate.sacrifice) {
        if (candidate.sacMechanism === 'deflect') {
          add(true, 'sacMechanismDeflect', weights.sacMechanismDeflect,
            'sacrifice deflects the key defender from the king zone with a concrete follow-up');
        } else if (candidate.sacMechanism === 'lineOpen') {
          add(true, 'sacMechanismLineOpen', weights.sacMechanismLineOpen,
            'sacrifice rips open the king\u2019s cover along a fresh line');
        } else if (candidate.sacMechanism === 'tempo') {
          add(true, 'sacMechanismTempo', weights.sacMechanismTempo,
            'sacrifice keeps the initiative with check and a ready follow-up');
        } else if (!candidate.winningMate) {
          add(true, 'unexplainedSacrifice', weights.unexplainedSacrifice,
            'the material drop has no stated mechanism — an attacker explains the point first');
        }
      }
      // Zero-freedom initiative: every defender reply in the line was forced.
      add(candidate.zeroFreedom, 'zeroFreedom', weights.zeroFreedom,
        'every reply is forced — the defense never gets a free move');
      // Quiet attacking prep: net-closing moves between blows.
      add(candidate.quietPrepKind === 'kingSafety',
        'quietKingPrep', weights.quietKingPrep, 'tucks the king safe before reopening the attack');
      add(candidate.quietPrepKind === 'rookFile', 'quietRookFile', weights.quietRookFile,
        'swings the rook to the open file toward the king');
      add(candidate.quietPrepKind === 'pawnWedge', 'quietPawnWedge', weights.quietPawnWedge,
        'gains space with a pawn wedge near the enemy king');

      return calibrateAttackScore(amount, candidate, weights);
    }

    function calibrateAttackScore(raw, candidate, weights) {
      const overlap = [
        candidate.givesCheck,
        candidate.kingPressureDelta > 0,
        candidate.opensKingFile,
        candidate.contactCheck,
        candidate.penetrationDelta > 0
      ].filter(Boolean).length;
      const damped = overlap >= 3 ? raw / (1 + (overlap - 2) * 0.14) : raw;
      const sacrificeCap = Math.max(220, Math.abs(weights.soundSacrifice || 300) + Math.abs(weights.speculativeSacrifice || 180));
      const afterSacrifice = candidate.sacrifice ? Math.min(damped, sacrificeCap + Math.abs(raw) * 0.15) : damped;
      const opening = candidate.fen && detectGamePhase(candidate.fen) === 'opening';
      const phaseCap = opening ? 820 : 980;
      candidate.attackMomentum = Math.round(Math.max(0, overlap));
      return Math.max(-420, Math.min(phaseCap, Math.round(afterSacrifice)));
    }

    // ── Human-like coach (attacker rewards) ───────────────────────────
    function humanFeel(candidate) {
      let score = 0;
      const reward = (condition, value, reason) => {
        if (!condition) return;
        score += value;
        if (reason) candidate.humanReasons.push(reason);
      };
      reward(candidate.doubleCheck, 55, 'delivers a devastating double check');
      reward(candidate.givesCheck && candidate.forcingPly >= 1, 45, 'launches a direct, relentless attack');
      reward(candidate.kingPressureDelta > 0, Math.min(70, Math.round(candidate.kingPressureDelta * 22)), 'swarms the enemy king with relentless pressure');
      reward(candidate.penetrationDelta > 0, Math.min(60, candidate.penetrationDelta * 25), 'invades deep into enemy territory');
      reward(candidate.deepPenetrationDelta > 0, Math.min(70, candidate.deepPenetrationDelta * 30), 'establishes a terrifying deep-invasion attacking piece');
      reward(candidate.pawnStormDelta > 0, Math.min(65, candidate.pawnStormDelta * 28), 'drives a ruthless pawn storm straight at the enemy king');
      reward(candidate.sacrifice, candidate.sacrificeSoundness === 'sound' ? 80 : 50,
        candidate.sacrificeSoundness === 'sound' ? 'executes a sound, game-ending sacrifice' : 'launches a fearless speculative sacrifice to shatter the defense');
      reward(candidate.complexity >= 2, 40, 'creates a storm of forcing tactical chances');
      reward(candidate.opensKingFile, 45, 'rips open direct attack lines straight at the king');
      reward(candidate.attackUnitDelta > 0, Math.min(40, candidate.attackUnitDelta * 12), 'piles fresh attackers onto the enemy king');
      reward(candidate.practicalChancesScore > 0, Math.min(35, candidate.practicalChancesScore * 10), 'overwhelms the defenders in the king zone');
      reward(candidate.overloadScore > 0, Math.min(30, candidate.overloadScore * 12), 'hits overloaded defenders near the king');
      reward(candidate.tempoThreatCount > 1, 22, 'creates a web of simultaneous threats');
      reward(candidate.isGreekGift, 30, 'rips open the castled king with the classic Greek gift');
      reward(candidate.sacrifice && candidate.chaosSacrificeTrigger && candidate.sacrificeSoundness === 'speculative', 26,
        'gambles the piece for a direct shot at the king — exactly what a fearless attacker would try');
      // Cage family
      reward(candidate.kingCageDelta >= 2, 38, 'shuts off the king\'s escape squares — the net is closing');
      reward(candidate.kingSuffocation, 55, 'locks the king into a suffocating mating net');
      reward(candidate.backRank, 26, 'haunts the king\'s exposed back rank');
      reward(candidate.shieldStrike, 34, 'rips the pawn shield off the castled king');
      reward(candidate.contactCheck, 30, 'slams a contact check that cannot be blocked');
      reward(candidate.exchangeSac, 40, 'trades a rook for a knight/pawn right at the king\'s doorstep');
      reward(candidate.chased && candidate.kingPressureDelta > 0, 24, 'keeps hunting the exposed king without mercy');
      reward(candidate.punishUncastled, 30, 'punishes the enemy king still stuck in the centre');
      reward(candidate.rookLiftMove, 16, 'lifts the rook into the attack zone for the final push');
      // Kill-geometry mates
      reward(candidate.kingMobilityDelta > 0, Math.min(30, candidate.kingMobilityDelta * 12), 'squeezes the king — fewer escapes every move');
      reward(candidate.smotheredMate, 38, 'smothers the king inside its own pieces');
      reward(candidate.anastasiaMate, 30, 'locks the corner with the classic Anastasia net');
      reward(candidate.arabianMate, 30, 'seals the corner with the Arabian rook-and-knight net');
      reward(candidate.bodenMate, 26, 'criss-crosses the bishops for the classic Boden mate');
      reward(candidate.forcedMateNet, 30, 'the whole sequence is forced — mate is coming');
      reward(candidate.undefendedHit, 28, 'snaps up a defender that nobody is protecting');
      // Mating math, exploitation, traps and vision
      reward(candidate.maxSquareOutnumber >= 2, Math.min(42, candidate.maxSquareOutnumber * 14), 'counts more attackers than defenders on a mating square — it is winnable by force');
      reward(candidate.squareOutnumberDelta > 0, 26, 'turns a new mating square into a numbers win');
      reward(candidate.exchangeSac && candidate.maxSquareOutnumber >= 1, 30, 'the exchange sacrifice pays — counted attackers outnumber the king\'s defenders');
      reward(candidate.hangingPieceGrab, 26, 'takes a piece the opponent simply forgot to defend');
      reward(candidate.backRankExploit, 30, 'slams the cramped back rank — the king cannot run');
      reward(candidate.scholarTrap, 38, 'lures the opponent into the Scholar\'s mate net');
      reward(candidate.legalsTrap, 34, 'invites the Legal\'s mate trap on e5');
      reward(candidate.laskerTrap, 42, 'springs the Lasker trap — the pawn falls on the king with check');
      reward(candidate.followUpVision, 22, 'already sees the follow-up blow one move ahead');
      // Tactical toolkit
      reward(candidate.knightForkMove, 30, 'forks the king and queen with the knight — pick a side');
      reward(candidate.pinToKing, 24, 'pins a piece to the king — it cannot move');
      reward(candidate.pinToQueen, 20, 'pins a piece to the queen');
      reward(candidate.skewerCount > 0, 26, 'skewers the king to the piece behind it');
      reward(candidate.discoveredCheck, 28, 'unveils a discovered check — two threats from one move');
      reward(candidate.discoveredAttack, 22, 'unveils a discovered attack');
      reward(candidate.endgameCoup, 24, 'marches into the endgame — the king becomes a weapon');
      // Fast-finish coaching voice
      reward(candidate.earlyQueenMove && (candidate.givesCheck || candidate.kingPressureDelta > 0 || candidate.tempoThreatCount > 0),
        30, 'brings the queen out early to seize the initiative at once');
      reward(candidate.givesCheck && candidate.kingPressureDelta > 0, 26, 'rattles the king with immediate fast pressure');
      reward(candidate.forcingPly >= 2 || candidate.winningMate || (candidate.opensKingFile && candidate.givesCheck),
        34, 'goes straight for the win — finishes the game early');
      // Fast-kill coaching voice
      reward(candidate.mateSpeed > 0, 32, 'KOs the king as fast as the position allows');
      reward(candidate.narrowEscape, 30, 'slams shut the king\'s last escape route');
      reward(candidate.corridorMate, 40, 'delivers the corridor mate along the edge');
      reward(candidate.epauletteMate, 42, 'boxes the king in for the epaulette mate');
      reward(candidate.windmill, 38, 'starts the windmill — check after check, gathering wood free');
      reward(candidate.queenSac, 45, 'slams the queen down and crashes the defense for the win');
      reward(candidate.sustainedPressure > 0.65, 30, 'keeps pressing until the position breaks');
      return score;
    }

    // ── Annotation flavor tags ────────────────────────────────────────
    function annotate(features) {
      const tags = ['ultra-aggressive attack'];
      if (features.isGreekGift) tags.push('greek gift');
      if (features.overloadScore > 0) tags.push('overload');
      if (features.practicalChancesScore > 0) tags.push('practical chances');
      if (features.structuralComplexity > 0) tags.push('storm the king');
      if (features.kingSuffocation) tags.push('suffocating mate net');
      if (features.kingCageDelta >= 2) tags.push('closing the cage');
      if (features.backRank) tags.push('back-rank threat');
      if (features.shieldStrike) tags.push('pawn-shield strike');
      if (features.contactCheck) tags.push('contact check');
      if (features.exchangeSac) tags.push('exchange sacrifice');
      if (features.chased) tags.push('king hunt');
      if (features.punishUncastled) tags.push('punish uncastled king');
      if (features.rookLiftMove) tags.push('rook lift');
      if (features.kingMobilityDelta > 0) tags.push('tightens the tail');
      if (features.smotheredMate) tags.push('smothered mate');
      if (features.anastasiaMate) tags.push('anastasia mate');
      if (features.arabianMate) tags.push('arabian mate');
      if (features.bodenMate) tags.push('boden mate');
      if (features.forcedMateNet) tags.push('forced mate sequence');
      if (features.undefendedHit) tags.push('undefended defender');
      if (features.maxSquareOutnumber >= 2) tags.push('mating square won by force');
      if (features.squareOutnumberDelta > 0) tags.push('outnumbers the defenders');
      if (features.exchangeSac && features.maxSquareOutnumber >= 1) tags.push('sound exchange sacrifice');
      if (features.hangingPieceGrab) tags.push('hanging piece grab');
      if (features.backRankExploit) tags.push('back-rank fragility');
      if (features.scholarTrap) tags.push('scholar\'s mate trap');
      if (features.legalsTrap) tags.push('legal\'s mate trap');
      if (features.laskerTrap) tags.push('lasker trap');
      if (features.followUpVision) tags.push('second-move vision');
      if (features.knightForkMove) tags.push(features.royalFork ? 'royal fork' : 'knight fork');
      if (features.pinToKing) tags.push('absolute pin');
      if (features.pinToQueen) tags.push('relative pin');
      if (features.skewerCount > 0) tags.push('skewer');
      if (features.discoveredCheck) tags.push('discovered check');
      if (features.discoveredAttack) tags.push('discovered attack');
      if (features.endgameCoup) tags.push('endgame coup');
      if (features.earlyQueenMove && (features.givesCheck || features.kingPressureDelta > 0 || features.tempoThreatCount > 0)) tags.push('early queen raid');
      if (features.givesCheck && features.kingPressureDelta > 0) tags.push('fast king pressure');
      if (features.forcingPly >= 2 || features.winningMate || (features.opensKingFile && features.givesCheck)) tags.push('fast finish');
      if (features.mateSpeed > 0) tags.push('fast KO');
      if (features.narrowEscape) tags.push('last exit slammed');
      if (features.corridorMate) tags.push('corridor mate');
      if (features.epauletteMate) tags.push('epaulette mate');
      if (features.windmill) tags.push('windmill');
      if (features.queenSac) tags.push('queen sacrifice');
      if (features.sustainedPressure > 0.65) tags.push('relentless pressure');
      return tags;
    }

    // ── Plan text ────────────────────────────────────────────────────
    // Highest-priority attack plan for the candidate, or `null` so the host
    // can fall back to its generic plan text.
    function choosePlan(f) {
      if (f.forcedMateNet) return 'start the forced mate sequence';
      if (f.smotheredMate) return 'smother the king in its own pieces';
      if (f.anastasiaMate) return 'drive the Anastasia mate on the corner file';
      if (f.arabianMate) return 'close the Arabian net in the corner';
      if (f.bodenMate) return 'criss-cross the bishops for a Boden mate';
      if (f.kingSuffocation) return 'close the mating net';
      if (f.kingCageDelta >= 2) return 'tighten the cage around the king';
      if (f.scholarTrap) return 'lay the Scholar\'s mate trap on f7';
      if (f.legalsTrap) return 'spring the Legal\'s mate trap on e5';
      if (f.laskerTrap) return 'spring the Lasker trap on the king\'s rank';
      if (f.shieldStrike) return 'strip the pawn shield';
      if (f.exchangeSac) return 'trade wood for the king\'s defenders';
      if (f.backRankExploit) return 'exploit the cramped back rank';
      if (f.knightForkMove) return f.royalFork ? 'fork the king and queen with the knight' : 'fork two pieces with the knight';
      if (f.pinToKing) return 'pin a piece to the enemy king';
      if (f.pinToQueen) return 'pin a piece to the enemy queen';
      if (f.skewerCount > 0) return 'skewer the king or queen to the piece behind';
      if (f.discoveredAttack) return f.discoveredCheck ? 'unveil a discovered check' : 'unveil a discovered attack';
      if (f.hangingPieceGrab) return 'snap up the hanging piece';
      if (f.endgameCoup) return 'exploit the endgame blind spot';
      // Fast-kill plans (concrete, above the generic fast-finish fallback)
      if (f.corridorMate) return 'deliver the corridor mate along the edge';
      if (f.epauletteMate) return 'box the king in for the epaulette mate';
      if (f.windmill) return 'start the windmill and strip the defense';
      if (f.queenSac) return f.forcedMateNet ? 'sacrifice the queen for the forced mate' : 'sacrifice the queen to crash the defense';
      if (f.narrowEscape && f.mateSpeed > 0) return 'slam shut the last escape and land the mate now';
      if (f.mateSpeed >= 0.9) return 'finish the forced mate sequence immediately';
      // Fast-finish plans (fallback after the concrete motifs)
      if (f.earlyQueenMove && (f.givesCheck || f.kingPressureDelta > 0 || f.tempoThreatCount > 0)) return 'bring the queen out early and attack immediately';
      if (f.givesCheck && f.kingPressureDelta > 0) return 'keep the pressure on and finish fast';
      if (f.forcingPly >= 2 || f.winningMate || (f.opensKingFile && f.givesCheck)) return 'drive straight at the king and finish the game now';
      return null;
    }

    // ── Winning-plan text ────────────────────────────────────────────
    function winningPlan(evalScore, phase) {
      if (evalScore > 100) {
        return phase === 'endgame'
          ? 'Finish fast in the endgame: activate the king, march it toward the enemy king, and hunt every check and capture — the endgame is where your opponent blunders most.'
          : 'Finish fast: count the attackers on the king\'s mating squares, spring the classic opening strike if it is still on the board, fork or pin the big pieces, and ride the forced mate sequence until the position collapses.';
      }
      if (evalScore > -100) {
        return 'Ultra aggressive attack vs <=1100: open lines, launch pawn storms, chase the king out of its castle, and sacrifice fearlessly to overwhelm their defense.';
      }
      return 'Fearless counter-attack: hunt the exposed king, hit every defender, and trade wood for time until their position cracks!';
    }

    // ── Dynamic weight scaling ─────────────────────────────────────────
    // The attack is most brutal the closer the enemy king is to collapse, so
    // a pre-compressed/uncastled king (or a king whose escape squares are
    // being removed) tiles aggression upwards, while a healthy, castled-safe
    // king dampens it so we don't swat at air.
    function fragilityMultiplier(candidate) {
      let m = 1;
      if (candidate.punishUncastled) m += 0.25;
      if (candidate.chased) m += 0.15;
      if (candidate.kingCageDelta >= 2) m += 0.2;
      if (candidate.kingSuffocation || candidate.kingMobilityDelta > 0) m += 0.15;
      if (candidate.backRankFragile) m += 0.1;
      return Math.min(1.8, m);
    }

    function aggressionRamp(moveNumber) {
      if (typeof moveNumber !== 'number') return 1;
      if (moveNumber <= 10) return 1.3;
      if (moveNumber <= 18) return 1.15;
      return 1;
    }

    function scaledWeights(candidate, phase, moveNumber) {
      const base = Object.assign({}, profile.weights);
      const frag = fragilityMultiplier(candidate || {});
      const ramp = aggressionRamp(moveNumber);
      const attackKeys = [
        'kingCage', 'kingSuffocation', 'shieldStrike', 'contactCheck',
        'kingChase', 'punishUncastled', 'rookLift', 'kingMobility',
        'smotheredMate', 'anastasiaMate', 'arabianMate', 'bodenMate',
        'mateSpeed', 'narrowEscape', 'sustainedPressure', 'windmillAttack',
        'corridorMate', 'epauletteMate', 'queenSacForCharge'
      ];
      for (const k of attackKeys) {
        if (typeof base[k] === 'number') base[k] = Math.round(base[k] * frag);
      }
      if (phase === 'opening' || phase === 'middlegame') {
        for (const k of ['check', 'doubleCheck', 'forcingPly', 'kingPressure', 'pawnStorm']) {
          if (typeof base[k] === 'number') base[k] = Math.round(base[k] * ramp);
        }
      }
      return base;
    }

    function firedMotifs(features) {
      const out = {};
      const keys = [
        'kingSuffocation', 'backRank', 'shieldStrike', 'contactCheck',
        'exchangeSac', 'chased', 'punishUncastled', 'rookLiftMove',
        'smotheredMate', 'anastasiaMate', 'arabianMate', 'bodenMate', 'forcedMateNet',
        'undefendedHit', 'hangingPieceGrab', 'backRankExploit', 'scholarTrap',
        'legalsTrap', 'laskerTrap', 'followUpVision', 'knightForkMove', 'pinToKing',
        'pinToQueen', 'discoveredAttack', 'endgameCoup', 'corridorMate',
        'epauletteMate', 'windmill', 'queenSac', 'narrowEscape'
      ];
      for (const k of keys) if (features[k]) out[k] = true;
      if (features.kingCageDelta >= 2) out.kingCage = true;
      if (features.sustainedPressure > 0.65) out.sustainedPressure = true;
      if (features.mateSpeed > 0) out.mateSpeed = true;
      return out;
    }

    return {
      profile,
      computeFeatures,
      styleBonus,
      humanFeel,
      annotate,
      choosePlan,
      winningPlan,
      scaledWeights,
      fragilityMultiplier,
      firedMotifs,
      isChaos: (id) => id === profile.id
    };
  }

  // Attach the factory to the global (`window` in the page / vm sandbox).
  const api = { createEngine };
  if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ChaosAttack = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);