import { useEffect, useRef, useState } from 'react';

interface PasteVisualizerProps {
    mode: 'enter' | 'no-enter';
    bars?: number;
    rows?: number;
    pixelWidth?: number;
    pixelHeight?: number;
}

function buildNoEnterPath(bars: number, rows: number): [number, number][] {
    const path: [number, number][] = [];
    const midRow = Math.floor((rows - 1) / 2) - 1;
    const leftCol = 2;
    const rightCol = bars - 2;

    for (let col = leftCol; col <= rightCol - 2; col += 1) {
        path.push([col, midRow]);
        path.push([col, midRow + 1]);
        path.push([col, midRow + 2]);
    }

    path.push([rightCol - 2, midRow - 1]);
    path.push([rightCol - 2, midRow]);
    path.push([rightCol - 2, midRow + 1]);
    path.push([rightCol - 2, midRow + 2]);
    path.push([rightCol - 2, midRow + 3]);
    path.push([rightCol - 1, midRow]);
    path.push([rightCol - 1, midRow + 1]);
    path.push([rightCol - 1, midRow + 2]);
    path.push([rightCol, midRow]);
    path.push([rightCol, midRow + 1]);
    path.push([rightCol, midRow + 2]);
    path.push([rightCol + 1, midRow + 1]);

    return path;
}

function buildEnterPath(bars: number, rows: number): [number, number][] {
    const path: [number, number][] = [];
    const rightCol = bars - 3;
    const leftCol = 2;
    const topRow = 0;
    const bottomRow = rows - 5;

    for (let row = topRow; row <= bottomRow + 1; row += 1) {
        path.push([rightCol, row]);
        path.push([rightCol - 1, row]);
        path.push([rightCol - 2, row]);
    }

    for (let col = rightCol - 3; col >= leftCol + 1; col -= 1) {
        path.push([col, bottomRow - 1]);
        path.push([col, bottomRow]);
        path.push([col, bottomRow + 1]);
    }

    path.push([leftCol + 1, bottomRow - 2]);
    path.push([leftCol + 1, bottomRow + 2]);
    path.push([leftCol, bottomRow - 1]);
    path.push([leftCol, bottomRow]);
    path.push([leftCol, bottomRow + 1]);
    path.push([leftCol - 1, bottomRow]);

    return path;
}

function getAmberColor(brightness: number): string {
    const lightness = Math.round(20 + brightness * 45);
    return `hsl(42, 100%, ${lightness}%)`;
}

const DIM_COLOR = 'hsl(42, 40%, 12%)';
const TAIL_LENGTH = 60;
const SPEED_MS = 3;
const SPEED_MULTIPLIER = 2;

interface ShapeVisualizerProps {
    path: [number, number][];
    bars: number;
    rows: number;
    pixelWidth: number;
    pixelHeight: number;
}

const ShapeVisualizer = ({
    path,
    bars,
    rows,
    pixelWidth,
    pixelHeight,
}: ShapeVisualizerProps) => {
    const shapeSet = new Set(path.map(([col, row]) => `${col},${row}`));
    const totalSteps = path.length + TAIL_LENGTH;
    const [head, setHead] = useState(0);
    const animationFrameRef = useRef<number | null>(null);
    const lastTimeRef = useRef(0);

    useEffect(() => {
        setHead(0);
        lastTimeRef.current = 0;
        let running = true;

        const tick = (time: number) => {
            if (!running) {
                return;
            }

            if (time - lastTimeRef.current >= SPEED_MS) {
                lastTimeRef.current = time;
                setHead((current) => (current + SPEED_MULTIPLIER) % totalSteps);
            }

            animationFrameRef.current = requestAnimationFrame(tick);
        };

        animationFrameRef.current = requestAnimationFrame(tick);
        return () => {
            running = false;
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [totalSteps]);

    const brightnessMap = new Map<string, number>();
    for (let index = 0; index < TAIL_LENGTH; index += 1) {
        const pathIndex = head - index;
        if (pathIndex < 0 || pathIndex >= path.length) {
            continue;
        }

        const [col, row] = path[pathIndex];
        const brightness = 1 - index / TAIL_LENGTH;
        const key = `${col},${row}`;
        const existing = brightnessMap.get(key) ?? 0;
        brightnessMap.set(key, Math.max(existing, brightness));
    }

    return (
        <div className="flex gap-0.5 w-full">
            {Array.from({ length: bars }).map((_, colIdx) => (
                <div key={`col-${colIdx}`} className="flex flex-col gap-0.5 flex-1">
                    {Array.from({ length: rows }).map((_, rowIdx) => {
                        const key = `${colIdx},${rowIdx}`;
                        const brightness = brightnessMap.get(key);
                        const isOnShape = shapeSet.has(key);
                        const color =
                            brightness !== undefined
                                ? getAmberColor(brightness)
                                : isOnShape
                                  ? DIM_COLOR
                                  : 'transparent';

                        return (
                            <div
                                key={`pixel-${colIdx}-${rowIdx}`}
                                style={{
                                    width: `${pixelWidth}px`,
                                    height: `${pixelHeight}px`,
                                    backgroundColor: color,
                                }}
                            />
                        );
                    })}
                </div>
            ))}
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
    const path = mode === 'enter' ? buildEnterPath(bars, rows) : buildNoEnterPath(bars, rows);

    return (
        <ShapeVisualizer
            path={path}
            bars={bars}
            rows={rows}
            pixelWidth={pixelWidth}
            pixelHeight={pixelHeight}
        />
    );
};
