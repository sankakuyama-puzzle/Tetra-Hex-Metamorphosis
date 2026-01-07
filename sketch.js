/**
 * Tetra-Hex Metamorphosis v15.2 [Bug Fix & Visual Sync]
 * 
 * 修正点:
 * 1. ReferenceError (lastStepTime) の解消
 * 2. 前作のビジュアル（アンビエントライト最大＋黒エッジ）を忠実に再現
 * 3. ピースの回転ロジックを v15.0 (魔法の定数) に固定
 */

let R = 15.0;
let spacing = 30.0;
let layerH = 30.0 * 0.7071;
let tetraH = 30.0 * 0.816;

let pos2D, posTetra, posPyramid;
const Modes = { HEX2D: 'HEX2D', TETRA: 'TETRA', PYRAMID: 'PYRAMID' };
let currentMode = Modes.HEX2D;
let sourceMode = Modes.HEX2D;

let solutionsData;
let pieces = [];
let grid2D = [], gridTetra = [], gridPyramid = [];
let chamferedGeometry = []; 

let movingPieceIdx = -1;
let pieceMoveT = 0;
let lastStepTime = 0; // 変数名を統一
let waitDuration = 4000; 
let isRepeatMode = false;
let isPaused = false;
let speedIdx = 0;
const pieceDurations = [500, 1000, 2000];
const speedLabels = ["Normal (0.5s)", "Slow (1.0s)", "Super Slow (2.0s)"];

let savedSol2D, savedSolTetra, savedSolPyr;

// Camera / Interaction
let rotX = -0.5, rotY = 0.5, curZoom = 1.35;
let camLookAt;

function preload() {
    solutionsData = loadJSON('solutions.json');
}

function setup() {
    createCanvas(windowWidth, windowHeight, WEBGL);
    pixelDensity(displayDensity());
    
    pos2D = createVector(-220, 0, 120);
    posTetra = createVector(220, 0, 120);
    posPyramid = createVector(0, 0, -220);
    camLookAt = pos2D.copy();

    initGrids();
    chamferedGeometry = generateChamferedBase(R);
    firstLoad();
    lastStepTime = millis();
}

function draw() {
    background(235);
    ortho(-width / 2, width / 2, -height / 2, height / 2, -5000, 5000);

    if (!isPaused) updateLogic();

    // 前作の設定: フラットで明るいライト
    ambientLight(255);

    push();
    translate(0, 50, 0);
    scale(curZoom);
    rotateX(rotX);
    rotateY(rotY);
    translate(-camLookAt.x, -camLookAt.y, -camLookAt.z);

    drawBases();
    drawPieces();
    drawKingChamber();
    pop();
    
    updateUI();
}

class Piece {
    constructor(name) {
        this.name = name;
        this.pc = getPieceColor(name);
        this.currentPos = Array.from({ length: 4 }, () => createVector(0, 0, 0));
        this.targetPos = Array.from({ length: 4 }, () => createVector(0, 0, 0));
        this.mapping = [0, 1, 2, 3];
        this.isLeftover = false;
        this.stackScore = 0;
        this.pSourceMode = Modes.HEX2D;
        this.pTargetMode = Modes.HEX2D;
    }

    getCOG(pts) {
        let c = createVector(0, 0, 0);
        let count = 0;
        for (let p of pts) {
            if (p) { c.add(p); count++; }
        }
        return count > 0 ? c.div(count) : c;
    }

    planMove(nextPoints, fromMode, toMode) {
        this.targetPos = nextPoints;
        this.pSourceMode = fromMode;
        this.pTargetMode = toMode;

        let minDist = Infinity;
        const perms = [[0,1,2,3],[0,1,3,2],[0,2,1,3],[0,2,3,1],[0,3,1,2],[0,3,2,1],
                       [1,0,2,3],[1,0,3,2],[1,2,0,3],[1,2,3,0],[1,3,0,2],[1,3,2,0],
                       [2,0,1,3],[2,0,3,1],[2,1,0,3],[2,1,3,0],[2,3,0,1],[2,3,1,0],
                       [3,0,1,2],[3,0,2,1],[3,1,0,2],[3,1,2,0],[3,2,0,1],[3,2,1,0]];
        for (let pPerm of perms) {
            let d = 0;
            for (let i = 0; i < 4; i++) d += p5.Vector.dist(this.currentPos[i], nextPoints[pPerm[i]]);
            if (d < minDist) {
                minDist = d;
                this.mapping = [...pPerm];
            }
        }
        this.calculateStackScore();
    }

    calculateStackScore() {
        let cog = this.getCOG(this.targetPos);
        if (this.pTargetMode === Modes.HEX2D) {
            this.stackScore = -cog.z * 1000 - cog.x;
        } else {
            let avgY = 0; let groundCount = 0; let hasPeak = false;
            for (let p of this.targetPos) {
                avgY += p.y;
                if (p.y > -R - 2.0) groundCount++;
                if (this.pTargetMode === Modes.TETRA && p.y < -5 * tetraH + 1) hasPeak = true;
                if (this.pTargetMode === Modes.PYRAMID && p.y < -4 * layerH + 1) hasPeak = true;
            }
            this.stackScore = groundCount * 10000 + (avgY / 4.0) - (hasPeak ? 50000 : 0);
        }
    }

    finalizeMove() {
        for (let i = 0; i < 4; i++) this.currentPos[i] = this.targetPos[this.mapping[i]].copy();
        this.pSourceMode = this.pTargetMode;
    }
}

function initGrids() {
    let hexH = spacing * 0.866;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 7; c++) {
            let x = (c - 3) * spacing + ((r % 2 === 1) ? -spacing / 2 : 0);
            grid2D.push(createVector(x + pos2D.x, -R, (3.5 - r) * hexH + pos2D.z));
        }
    }
    for (let d = 0; d < 6; d++) {
        let s = 6 - d;
        for (let r = 0; r < s; r++) {
            for (let c = 0; c < s - r; c++) {
                gridTetra.push(createVector((c + r * 0.5 - (s - 1) * 0.5) * spacing + posTetra.x, -d * tetraH - R, (r * 0.866 - (s - 1) * 0.288) * spacing + posTetra.z));
            }
        }
    }
    for (let l = 0; l < 5; l++) {
        let s = 5 - l;
        let offset = (5 - s) * 0.5 * spacing;
        for (let r = 0; r < s; r++) {
            for (let c = 0; c < s; c++) {
                gridPyramid.push(createVector((c * spacing) - 2.0 * spacing + offset + posPyramid.x, -l * layerH - R, (r * spacing) - 2.0 * spacing + offset + posPyramid.z));
            }
        }
    }
}

function firstLoad() {
    let solArray = Array.isArray(solutionsData) ? solutionsData : Object.values(solutionsData);
    let p2DPool = solArray.filter(s => s.mode === "2D_HEX");
    if (p2DPool.length === 0) return;
    
    savedSol2D = random(p2DPool);
    let masks = parseMasks(savedSol2D.data);
    pieces = [];
    for (let name in masks) {
        let p = new Piece(name);
        let mk = masks[name];
        let count = 0;
        for (let b = 0; b < 56; b++) {
            if ((BigInt(mk) >> BigInt(b)) & 1n) {
                p.currentPos[count++] = grid2D[b].copy();
            }
        }
        p.pSourceMode = p.pTargetMode = Modes.HEX2D;
        pieces.push(p);
    }
}

function updateLogic() {
    let now = millis();
    if (movingPieceIdx === -1) {
        if (now - lastStepTime > waitDuration) prepareNextPhase();
    } else {
        pieceMoveT += deltaTime / pieceDurations[speedIdx];
        if (pieceMoveT >= 1.0) {
            pieces[movingPieceIdx].finalizeMove();
            movingPieceIdx++;
            pieceMoveT = 0;
            if (movingPieceIdx >= pieces.length) {
                movingPieceIdx = -1;
                lastStepTime = millis();
            }
        }
    }
    let targetBase = (currentMode === Modes.HEX2D) ? pos2D : (currentMode === Modes.TETRA) ? posTetra : posPyramid;
    camLookAt = p5.Vector.lerp(camLookAt, targetBase, 0.04);
}

function prepareNextPhase() {
    let solArray = Array.isArray(solutionsData) ? solutionsData : Object.values(solutionsData);
    let oldMode = currentMode;
    if (currentMode === Modes.HEX2D) currentMode = Modes.TETRA;
    else if (currentMode === Modes.TETRA) currentMode = Modes.PYRAMID;
    else currentMode = Modes.HEX2D;

    let targetModeKey = (currentMode === Modes.HEX2D) ? "2D_HEX" : (currentMode === Modes.TETRA) ? "TETRA" : "PHARAOH";
    let nextSol;

    if (isRepeatMode) {
        if (currentMode === Modes.HEX2D) nextSol = savedSol2D;
        else if (currentMode === Modes.TETRA) nextSol = savedSolTetra;
        else nextSol = savedSolPyr;
    } else {
        let pool = solArray.filter(s => s.mode === targetModeKey);
        nextSol = random(pool);
        if (currentMode === Modes.HEX2D) savedSol2D = nextSol;
        else if (currentMode === Modes.TETRA) savedSolTetra = nextSol;
        else savedSolPyr = nextSol;
    }

    let masks = new Map();
    let leftoverID = "";
    for (let pair of nextSol.data.split(";")) {
        let kv = pair.split(",");
        if (kv.length !== 2) continue;
        if (kv[0] === "LEFTOVER") leftoverID = kv[1];
        else if (kv[0] !== "CHAMBER") {
            if (!masks.has(kv[0])) masks.set(kv[0], []);
            masks.get(kv[0]).push(kv[1]);
        }
    }

    for (let p of pieces) {
        let targets = Array.from({ length: 4 }, () => null);
        let key = masks.has(p.name) ? p.name : p.name.replace(/\d+/g, '');
        p.isLeftover = (p.name === leftoverID);

        if (!p.isLeftover && masks.has(key) && masks.get(key).length > 0) {
            let mk = masks.get(key).shift();
            let count = 0;
            let grid = (currentMode === Modes.TETRA) ? gridTetra : (currentMode === Modes.PYRAMID) ? gridPyramid : grid2D;
            for (let b = 0; b < grid.length; b++) {
                if ((BigInt(mk) >> BigInt(b)) & 1n) targets[count++] = grid[b].copy();
            }
        } else {
            let floorPos = createVector(posPyramid.x + 180, 0, posPyramid.z + 120);
            let cog = p.getCOG(p.currentPos);
            for (let i = 0; i < 4; i++) targets[i] = p5.Vector.add(p5.Vector.sub(p.currentPos[i], cog), floorPos);
        }
        p.planMove(targets, oldMode, currentMode);
    }
    pieces.sort((a, b) => b.stackScore - a.stackScore);
    movingPieceIdx = 0;
    pieceMoveT = 0;
}

function drawPieces() {
    for (let i = 0; i < pieces.length; i++) {
        let p = pieces[i];
        let t = (i === movingPieceIdx) ? pieceMoveT : (i < movingPieceIdx ? 1.0 : 0.0);
        drawFinalPiece(p, t, (i === movingPieceIdx));
    }
}

function drawFinalPiece(p, t, isMoving) {
    let startCog = p.getCOG(p.currentPos);
    let endCog = p.getCOG(p.targetPos);
    let curCog = p5.Vector.lerp(startCog, endCog, t);
    if (isMoving) curCog.y -= sin(PI * t) * 280;

    push();
    translate(curCog.x, curCog.y, curCog.z);
    if (isMoving) { rotateY(t * TWO_PI); rotateX(t * PI); }

    // 魔法の姿勢定数 (v15.0準拠)
    let tX_S = (p.pSourceMode === Modes.PYRAMID) ? 0 : (p.pSourceMode === Modes.HEX2D ? HALF_PI - atan(1.0/sqrt(2.0)) : HALF_PI + atan(1.0/sqrt(2.0)));
    let tX_E = (p.pTargetMode === Modes.PYRAMID) ? 0 : (p.pTargetMode === Modes.HEX2D ? HALF_PI - atan(1.0/sqrt(2.0)) : HALF_PI + atan(1.0/sqrt(2.0)));
    let yR = QUARTER_PI;

    let curX = lerp(tX_S, tX_E, t);
    let xSl = lerp((p.pSourceMode === Modes.PYRAMID && p.isLeftover) ? HALF_PI : 0, (p.pTargetMode === Modes.PYRAMID && p.isLeftover) ? HALF_PI : 0, t);

    for (let i = 0; i < 4; i++) {
        let pRef = isMoving ? p.currentPos[i] : (t === 1.0 ? p.targetPos[p.mapping[i]] : p.currentPos[i]);
        let cogRef = isMoving ? startCog : (t === 1.0 ? endCog : startCog);
        let rel = p5.Vector.sub(pRef, cogRef);
        push();
        translate(rel.x, rel.y, rel.z);
        rotateX(curX); rotateY(yR); rotateX(xSl);
        
        fill(p.pc); stroke(0); strokeWeight(0.5);
        chamferedGeometry.forEach(f => {
            beginShape(); f.forEach(v => vertex(v.x, v.y, v.z)); endShape(CLOSE);
        });
        pop();
    }
    pop();
}

function drawKingChamber() {
    if (currentMode !== Modes.PYRAMID && !(movingPieceIdx !== -1 && currentMode === Modes.PYRAMID)) return;
    let ids = [11, 12, 13];
    stroke(255, 215, 0); strokeWeight(3.5); noFill();
    for (let id of ids) {
        push();
        translate(gridPyramid[id].x, gridPyramid[id].y, gridPyramid[id].z);
        rotateY(QUARTER_PI);
        chamferedGeometry.forEach(f => {
            beginShape(); f.forEach(v => vertex(v.x, v.y, v.z)); endShape(CLOSE);
        });
        pop();
    }
}

function drawBases() {
    noStroke(); fill(210, 205, 195);
    push(); translate(pos2D.x, 7.5, pos2D.z); box(240, 15, 250); pop();
    drawDimples(grid2D, 56);
    push();
    translate(posTetra.x, 0, posTetra.z);
    let tS = 220, tH = tS * 0.866, tZ = tH * 0.333;
    fill(210, 205, 195);
    beginShape(); vertex(-tS/2, 0, -tZ); vertex(tS/2, 0, -tZ); vertex(0, 0, tH - tZ); endShape(CLOSE);
    beginShape(QUAD_STRIP);
    let bpts = [[-tS/2,-tZ],[tS/2,-tZ],[0,tH-tZ],[-tS/2,-tZ]];
    for(let pt of bpts){ vertex(pt[0], 0, pt[1]); vertex(pt[0], 15, pt[1]); }
    endShape();
    pop();
    drawDimples(gridTetra, 21);
    fill(200, 195, 185); push(); translate(posPyramid.x, 7.5, posPyramid.z); box(200, 15, 200); pop();
}

function drawDimples(grid, count) {
    fill(150, 145, 135);
    for (let i = 0; i < count; i++) {
        push(); translate(grid[i].x, -0.1, grid[i].z); rotateX(HALF_PI); ellipse(0, 0, 14, 14); pop();
    }
}

function generateChamferedBase(r) {
    let a = r * (Math.sqrt(2.0) - 1.0), b = r, vJ = r / Math.sqrt(2.0);
    let vRaw = []; let signs = [1, -1];
    for (let sx of signs) for (let sy of signs) for (let sz of signs) {
        vRaw.push(createVector(sx*b, sy*a, sz*a), createVector(sx*a, sy*b, sz*a), createVector(sx*a, sy*a, sz*b), createVector(sx*vJ, sy*vJ, sz*vJ));
    }
    let normals = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0],[1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1],[0,1,1],[0,1,-1],[0,-1,1],[0,-1,-1]];
    return normals.map(n => {
        let nv = createVector(n[0], n[1], n[2]).normalize();
        let faceV = vRaw.filter(p => Math.abs(p.dot(nv) - r) < 0.1);
        if (faceV.length < 3) return [];
        let center = createVector(0,0,0); faceV.forEach(p => center.add(p)); center.div(faceV.length);
        let v1 = p5.Vector.sub(faceV[0], center).normalize(), v2 = p5.Vector.cross(nv, v1).normalize();
        faceV.sort((a, b) => atan2(p5.Vector.sub(a, center).dot(v2), p5.Vector.sub(a, center).dot(v1)) - atan2(p5.Vector.sub(b, center).dot(v2), p5.Vector.sub(b, center).dot(v1)));
        return faceV;
    });
}

function updateUI() {
    let d2d = document.getElementById('file-2d-display');
    if (d2d) d2d.innerText = `REPEAT: ${isRepeatMode ? 'ON' : 'OFF'}`;
    let d3d = document.getElementById('file-3d-display');
    if (d3d) d3d.innerText = `3D Mode: ${currentMode}`;
    let spd = document.getElementById('speed-display');
    if (spd) spd.innerText = `SPEED: ${speedLabels[speedIdx]}`;
    let st = document.getElementById('state-display');
    if (st) st.innerText = movingPieceIdx === -1 ? (isPaused ? "PAUSED" : "WAITING") : `STACKING PIECE ${movingPieceIdx + 1}/14`;
}

function getPieceColor(n) {
    let br = (n.includes("2") || n.endsWith("R")) ? 0.65 : 1.0;
    colorMode(HSB, 360, 100, 100);
    let h = 0;
    if (n.startsWith("I")) h = 0; else if (n.startsWith("S")) h = 135; else if (n.startsWith("Z")) h = 50;
    else if (n.startsWith("C")) h = 280; else if (n.startsWith("J")) h = 200; else if (n.startsWith("P")) h = 30; else if (n.startsWith("Y")) h = 175;
    let c = color(h, 80, 95 * br);
    colorMode(RGB, 255);
    return c;
}

function parseMasks(raw) {
    let map = {};
    for (let pair of raw.split(";")) { let kv = pair.split(","); if (kv.length === 2) map[kv[0]] = kv[1]; }
    return map;
}

function keyPressed() {
    if (key === 's' || key === 'S') speedIdx = (speedIdx + 1) % 3;
    if (key === 'r' || key === 'R') isRepeatMode = !isRepeatMode;
    if (key === 'p' || key === 'P') isPaused = !isPaused;
}

function mouseDragged() {
    rotY += (mouseX - pmouseX) * 0.01;
    rotX = constrain(rotX - (mouseY - pmouseY) * 0.01, -HALF_PI, 0.3);
}

function mouseWheel(event) { curZoom = constrain(curZoom - event.delta * 0.001, 0.1, 5.0); return false; }

function windowResized() { resizeCanvas(windowWidth, windowHeight); }