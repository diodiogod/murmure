import { useEffect, useRef, useState } from 'react';

interface PasteVisualizerProps {
    mode: 'enter' | 'no-enter';
    bars?: number;
    rows?: number;
    pixelWidth?: number;
    pixelHeight?: number;
}

// Returns a list of [col, row] pairs forming the shape, in animation order (left to right)
// Shape is 3 pixels tall for visibility
function buildNoEnterPath(bars: number, rows: number): [number, number][] {
    const path: [number, number][] = [];
    const midRow = Math.floor((rows - 1) / 2) - 1; // Offset up by 1
    const leftCol = 2;
    const rightCol = bars - 2;

    // Shaft columns left to right, 3 rows tall
    for (let c = leftCol; c <= rightCol - 2; c++) {
        path.push([c, midRow]);
        path.push([c, midRow + 1]);
        path.push([c, midRow + 2]);
    }
    // Arrowhead: filled triangle pointing right
    // First column of arrowhead (5 pixels tall)
    path.push([rightCol - 2, midRow - 1]);
    path.push([rightCol - 2, midRow]);
    path.push([rightCol - 2, midRow + 1]);
    path.push([rightCol - 2, midRow + 2]);
    path.push([rightCol - 2, midRow + 3]);
    // Second column (3 pixels tall)
    path.push([rightCol - 1, midRow]);
    path.push([rightCol - 1, midRow + 1]);
    path.push([rightCol - 1, midRow + 2]);
    // Third column (3 pixels tall)
    path.push([rightCol, midRow]);
    path.push([rightCol, midRow + 1]);
    path.push([rightCol, midRow + 2]);
    // Tip pixel
    path.push([rightCol + 1, midRow + 1]);

    return path;
}

// ↵ shape: pixels in animation order (top-to-bottom snake)
// Vertical bar down, then horizontal bar left, then arrowhead
function buildEnterPath(bars: number, rows: number): [number, number][] {
    const path: [number, number][] = [];
    const rightCol = bars - 3;
    const leftCol = 2;
    const topRow = 0;
    const bottomRow = rows - 5;

    // Vertical bar downward (3 cols wide, interleaved per row)
    for (let r = topRow; r <= bottomRow + 1; r++) {
        path.push([rightCol, r]);
        path.push([rightCol - 1, r]);
        path.push([rightCol - 2, r]);
    }
    // Horizontal bar leftward (3 rows tall, interleaved per col)
    // Start from rightCol-3 to avoid overlap with vertical bar
    for (let c = rightCol - 3; c >= leftCol + 1; c--) {
        path.push([c, bottomRow - 1]);
        path.push([c, bottomRow]);
        path.push([c, bottomRow + 1]);
    }
    // Arrowhead pointing left (3 pixels tall)
    path.push([leftCol + 1, bottomRow - 2]);
    path.push([leftCol + 1, bottomRow + 2]);
    path.push([leftCol, bottomRow - 1]);
    path.push([leftCol, bottomRow]);
    path.push([leftCol, bottomRow + 1]);
    // Single tip pixel
    path.push([leftCol - 1, bottomRow]);

    return path;
}

function getAmberColor(brightness: number): string {
    const l = Math.round(20 + brightness * 45);
    return `hsl(42, 100%, ${l}%)`;
}

// Dim background color for the shape outline
const DIM_COLOR = 'hsl(42, 40%, 12%)';
const TAIL_LENGTH = 60;
const SPEED_MS = 3;
const SPEED_MULTIPLIER = 2; // Pixels to advance per frame

const EnterVisualizer = ({
    bars,
    rows,
    pixelWidth,
    pixelHeight,
}: { bars: number; rows: number; pixelWidth: number; pixelHeight: number }) => {
    const path = buildEnterPath(bars, rows);
    const shapeSet = new Set(path.map(([c, r]) => `${c},${r}`));
    const totalSteps = path.length + TAIL_LENGTH;
    const [head, setHead] = useState(0);
    const rafRef = useRef<number | null>(null);
    const lastTimeRef = useRef<number>(0);

    useEffect(() => {
        setHead(0);
        lastTimeRef.current = 0;
        let running = true;
        const tick = (time: number) => {
            if (!running) return;
            if (time - lastTimeRef.current >= SPEED_MS) {
                lastTimeRef.current = time;
                setHead((h) => (h + SPEED_MULTIPLIER) % totalSteps);
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => {
            running = false;
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [totalSteps]);

    const brightnessMap = new Map<string, number>();
    for (let i = 0; i < TAIL_LENGTH; i++) {
        const idx = head - i;
        if (idx < 0 || idx >= path.length) continue;
        const [c, r] = path[idx];
        const brightness = 1 - i / TAIL_LENGTH;
        const existing = brightnessMap.get(`${c},${r}`) ?? 0;
        brightnessMap.set(`${c},${r}`, Math.max(existing, brightness));
    }

    return (
        <div className="flex gap-0.5 w-full">
            {Array.from({ length: bars }).map((_, colIdx) => {
                const colKey = `col-${colIdx}`;
                return (
                    <div key={colKey} className="flex flex-col gap-0.5 flex-1">
                        {Array.from({ length: rows }).map((_, rowIdx) => {
                            const key = `${colIdx},${rowIdx}`;
                            const b = brightnessMap.get(key);
                            const isOnShape = shapeSet.has(key);
                            const color = b !== undefined
                                ? getAmberColor(b)
                                : isOnShape
                                    ? DIM_COLOR
                                    : 'transparent';
                            const pixelKey = `pixel-${colIdx}-${rowIdx}`;
                            return (
                                <div
                                    key={pixelKey}
                                    style={{
                                        width: `${pixelWidth}px`,
                                        height: `${pixelHeight}px`,
                                        backgroundColor: color,
                                    }}
                                />
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
};

const NoEnterVisualizer = ({
    bars,
    rows,
    pixelWidth,
    pixelHeight,
}: { bars: number; rows: number; pixelWidth: number; pixelHeight: number }) => {
    const path = buildNoEnterPath(bars, rows);
    const shapeSet = new Set(path.map(([c, r]) => `${c},${r}`));
    const totalSteps = path.length + TAIL_LENGTH;
    const [head, setHead] = useState(0);
    const rafRef = useRef<number | null>(null);
    const lastTimeRef = useRef<number>(0);

    useEffect(() => {
        setHead(0);
        lastTimeRef.current = 0;
        let running = true;
        const tick = (time: number) => {
            if (!running) return;
            if (time - lastTimeRef.current >= SPEED_MS) {
                lastTimeRef.current = time;
                setHead((h) => (h + SPEED_MULTIPLIER) % totalSteps);
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => {
            running = false;
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [totalSteps]);

    const brightnessMap = new Map<string, number>();
    for (let i = 0; i < TAIL_LENGTH; i++) {
        const idx = head - i;
        if (idx < 0 || idx >= path.length) continue;
        const [c, r] = path[idx];
        const brightness = 1 - i / TAIL_LENGTH;
        const existing = brightnessMap.get(`${c},${r}`) ?? 0;
        brightnessMap.set(`${c},${r}`, Math.max(existing, brightness));
    }

    return (
        <div className="flex gap-0.5 w-full">
            {Array.from({ length: bars }).map((_, colIdx) => {
                const colKey = `col-${colIdx}`;
                return (
                    <div key={colKey} className="flex flex-col gap-0.5 flex-1">
                        {Array.from({ length: rows }).map((_, rowIdx) => {
                            const key = `${colIdx},${rowIdx}`;
                            const b = brightnessMap.get(key);
                            const isOnShape = shapeSet.has(key);
                            const color = b !== undefined
                                ? getAmberColor(b)
                                : isOnShape
                                    ? DIM_COLOR
                                    : 'transparent';
                            const pixelKey = `pixel-${colIdx}-${rowIdx}`;
                            return (
                                <div
                                    key={pixelKey}
                                    style={{
                                        width: `${pixelWidth}px`,
                                        height: `${pixelHeight}px`,
                                        backgroundColor: color,
                                    }}
                                />
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
};

export const PasteVisualizer = ({
    mode,
    bars = 14,
    rows = 9,
    pixelWidth = 2,
    pixelHeight = 2,
}: PasteVisualizerProps) => {
    if (mode === 'enter') {
        return <EnterVisualizer bars={bars} rows={rows} pixelWidth={pixelWidth} pixelHeight={pixelHeight} />;
    }
    return <NoEnterVisualizer bars={bars} rows={rows} pixelWidth={pixelWidth} pixelHeight={pixelHeight} />;
};
