'use client';

import { useState, useCallback, useEffect } from 'react';
import { playTapSound, playLineCompleteSound, playPuzzleCompleteSound, playErrorSound } from '@/lib/sounds';

type Grid = number[][];
type MemoGrid = Set<number>[][];

interface HistoryEntry {
  grid: Grid;
  memos: number[][][]; // serialized memos
}

interface SudokuBoardProps {
  puzzle: Grid;
  solution: Grid;
  onProgress?: (grid: Grid, pct: number) => void;
  onComplete?: (timeSeconds: number) => void;
}

function serializeMemos(memos: MemoGrid): number[][][] {
  return memos.map(row => row.map(cell => Array.from(cell)));
}

function deserializeMemos(data: number[][][]): MemoGrid {
  return data.map(row => row.map(cell => new Set(cell)));
}

// 행/열/박스 완성 체크
function checkLineCompletion(grid: Grid, solution: Grid, row: number, col: number): boolean {
  // 행 완성?
  const rowComplete = grid[row].every((v, c) => v === solution[row][c]);
  // 열 완성?
  const colComplete = grid.every((r, ri) => r[col] === solution[ri][col]);
  // 박스 완성?
  const br = Math.floor(row / 3) * 3;
  const bc = Math.floor(col / 3) * 3;
  let boxComplete = true;
  for (let r = br; r < br + 3; r++) {
    for (let c = bc; c < bc + 3; c++) {
      if (grid[r][c] !== solution[r][c]) boxComplete = false;
    }
  }
  return rowComplete || colComplete || boxComplete;
}

export default function SudokuBoard({ puzzle, solution, onProgress, onComplete }: SudokuBoardProps) {
  const [grid, setGrid] = useState<Grid>(() => puzzle.map(row => [...row]));
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const [corrects, setCorrects] = useState<Set<string>>(new Set());
  const [startTime] = useState(Date.now());
  const [completed, setCompleted] = useState(false);

  // 새 기능: 메모 모드
  const [memoMode, setMemoMode] = useState(false);
  const [memos, setMemos] = useState<MemoGrid>(() =>
    Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set<number>()))
  );

  // 새 기능: 실행취소
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // 새 기능: 힌트 횟수
  const [hintsUsed, setHintsUsed] = useState(0);
  const MAX_HINTS = 3;

  // 새 기능: 실수 카운트
  const [mistakes, setMistakes] = useState(0);
  const MAX_MISTAKES = 5;

  // 남은 숫자 카운트
  const getNumberCounts = useCallback(() => {
    const counts: Record<number, number> = {};
    for (let n = 1; n <= 9; n++) counts[n] = 0;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (grid[r][c] !== 0) counts[grid[r][c]]++;
      }
    }
    return counts;
  }, [grid]);

  // 히스토리 저장
  const saveHistory = useCallback(() => {
    setHistory(prev => [...prev.slice(-30), {
      grid: grid.map(r => [...r]),
      memos: serializeMemos(memos),
    }]);
  }, [grid, memos]);

  // 진행률 계산
  const calcProgress = useCallback((g: Grid) => {
    let total = 0, filled = 0;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (puzzle[r][c] === 0) {
          total++;
          if (g[r][c] !== 0) filled++;
        }
      }
    }
    return total === 0 ? 100 : Math.round((filled / total) * 100);
  }, [puzzle]);

  // 같은 행/열/박스에 같은 숫자가 있는지 (충돌 하이라이트)
  const getConflicts = useCallback((row: number, col: number, num: number): string[] => {
    if (num === 0) return [];
    const conflicts: string[] = [];
    for (let c = 0; c < 9; c++) {
      if (c !== col && grid[row][c] === num) conflicts.push(`${row}-${c}`);
    }
    for (let r = 0; r < 9; r++) {
      if (r !== row && grid[r][col] === num) conflicts.push(`${r}-${col}`);
    }
    const br = Math.floor(row / 3) * 3;
    const bc = Math.floor(col / 3) * 3;
    for (let r = br; r < br + 3; r++) {
      for (let c = bc; c < bc + 3; c++) {
        if (r !== row && c !== col && grid[r][c] === num) conflicts.push(`${r}-${c}`);
      }
    }
    return conflicts;
  }, [grid]);

  // 숫자 입력
  const handleInput = useCallback((num: number) => {
    if (!selected || completed) return;
    const [row, col] = selected;
    if (puzzle[row][col] !== 0) return;

    // 메모 모드
    if (memoMode && num !== 0) {
      saveHistory();
      setMemos(prev => {
        const next = prev.map(r => r.map(c => new Set(c)));
        if (next[row][col].has(num)) {
          next[row][col].delete(num);
        } else {
          next[row][col].add(num);
        }
        return next;
      });
      return;
    }

    saveHistory();
    const key = `${row}-${col}`;
    const newGrid = grid.map(r => [...r]);

    if (num === 0) {
      newGrid[row][col] = 0;
      setErrors(prev => { const n = new Set(prev); n.delete(key); return n; });
      setCorrects(prev => { const n = new Set(prev); n.delete(key); return n; });
      playTapSound();
    } else if (solution[row][col] === num) {
      newGrid[row][col] = num;
      setErrors(prev => { const n = new Set(prev); n.delete(key); return n; });
      setCorrects(prev => new Set(prev).add(key));
      // 정답 입력 시 해당 셀 메모 제거 + 같은 행/열/박스 메모에서 해당 숫자 제거
      setMemos(prev => {
        const next = prev.map(r => r.map(c => new Set(c)));
        next[row][col].clear();
        for (let c = 0; c < 9; c++) next[row][c].delete(num);
        for (let r = 0; r < 9; r++) next[r][col].delete(num);
        const br = Math.floor(row / 3) * 3;
        const bc = Math.floor(col / 3) * 3;
        for (let r = br; r < br + 3; r++) {
          for (let c = bc; c < bc + 3; c++) next[r][c].delete(num);
        }
        return next;
      });
    } else {
      newGrid[row][col] = num;
      setErrors(prev => new Set(prev).add(key));
      setCorrects(prev => { const n = new Set(prev); n.delete(key); return n; });
      setMistakes(prev => prev + 1);
      playErrorSound();
      setTimeout(() => {
        setErrors(prev => { const n = new Set(prev); n.delete(key); return n; });
      }, 1000);
    }

    setGrid(newGrid);
    const pct = calcProgress(newGrid);
    onProgress?.(newGrid, pct);

    const isComplete = newGrid.every((r, ri) =>
      r.every((c, ci) => c === solution[ri][ci])
    );
    if (isComplete) {
      playPuzzleCompleteSound();
      setCompleted(true);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      onComplete?.(elapsed);
    } else if (solution[row][col] === num && checkLineCompletion(newGrid, solution, row, col)) {
      playLineCompleteSound();
    } else if (solution[row][col] === num) {
      playTapSound();
    }
  }, [selected, grid, puzzle, solution, completed, memoMode, startTime, calcProgress, onProgress, onComplete, saveHistory]);

  // 실행취소
  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setGrid(prev.grid);
    setMemos(deserializeMemos(prev.memos));
    setHistory(h => h.slice(0, -1));
  }, [history]);

  // 힌트
  const handleHint = useCallback(() => {
    if (hintsUsed >= MAX_HINTS || completed) return;

    // 빈 셀 중 하나를 랜덤으로 채우기
    const emptyCells: [number, number][] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (grid[r][c] === 0) emptyCells.push([r, c]);
      }
    }
    if (emptyCells.length === 0) return;

    // 선택된 셀이 비어있으면 그것부터
    let target: [number, number];
    if (selected && grid[selected[0]][selected[1]] === 0) {
      target = selected;
    } else {
      target = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    }

    saveHistory();
    const [row, col] = target;
    const newGrid = grid.map(r => [...r]);
    newGrid[row][col] = solution[row][col];

    setGrid(newGrid);
    setCorrects(prev => new Set(prev).add(`${row}-${col}`));
    setMemos(prev => {
      const next = prev.map(r => r.map(c => new Set(c)));
      next[row][col].clear();
      return next;
    });
    setHintsUsed(prev => prev + 1);
    setSelected([row, col]);

    const pct = calcProgress(newGrid);
    onProgress?.(newGrid, pct);

    const isComplete = newGrid.every((r, ri) =>
      r.every((c, ci) => c === solution[ri][ci])
    );
    if (isComplete) {
      playPuzzleCompleteSound();
      setCompleted(true);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      onComplete?.(elapsed);
    } else if (checkLineCompletion(newGrid, solution, row, col)) {
      playLineCompleteSound();
    } else {
      playTapSound();
    }
  }, [hintsUsed, completed, grid, solution, selected, saveHistory, calcProgress, startTime, onProgress, onComplete]);

  // 키보드 입력
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) handleInput(num);
      if (e.key === 'Backspace' || e.key === 'Delete') handleInput(0);
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleUndo(); }
      if (e.key === 'm' || e.key === 'M') setMemoMode(prev => !prev);

      if (selected) {
        const [r, c] = selected;
        if (e.key === 'ArrowUp' && r > 0) setSelected([r - 1, c]);
        if (e.key === 'ArrowDown' && r < 8) setSelected([r + 1, c]);
        if (e.key === 'ArrowLeft' && c > 0) setSelected([r, c - 1]);
        if (e.key === 'ArrowRight' && c < 8) setSelected([r, c + 1]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected, handleInput, handleUndo]);

  // 선택된 셀의 숫자와 같은 숫자 하이라이트
  const selectedNum = selected ? grid[selected[0]][selected[1]] : 0;

  const getCellClass = (row: number, col: number) => {
    const key = `${row}-${col}`;
    const classes = ['sudoku-cell'];
    const cellVal = grid[row][col];

    if (puzzle[row][col] !== 0) classes.push('fixed');
    if (selected && selected[0] === row && selected[1] === col) classes.push('selected');
    if (errors.has(key)) classes.push('error');
    if (corrects.has(key) && puzzle[row][col] === 0) classes.push('correct');

    // 같은 숫자 하이라이트
    if (selectedNum !== 0 && cellVal === selectedNum && !(selected && selected[0] === row && selected[1] === col)) {
      classes.push('highlight-same');
    }

    // 같은 행/열/박스 하이라이트
    if (selected) {
      const [sr, sc] = selected;
      const sameRow = row === sr;
      const sameCol = col === sc;
      const sameBox = Math.floor(row / 3) === Math.floor(sr / 3) && Math.floor(col / 3) === Math.floor(sc / 3);
      if ((sameRow || sameCol || sameBox) && !(row === sr && col === sc)) {
        classes.push('highlight-area');
      }
    }

    if (col % 3 === 2 && col < 8) classes.push('border-r-thick');
    if (row % 3 === 2 && row < 8) classes.push('border-b-thick');
    return classes.join(' ');
  };

  const numberCounts = getNumberCounts();

  return (
    <div className="flex flex-col gap-3">
      {/* 상태 바: 실수 카운트 + 힌트 잔여 */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-1 text-sm">
          <span className="text-red-400">실수</span>
          <span className="font-bold text-red-500">{mistakes}/{MAX_MISTAKES}</span>
        </div>
        <div className={`px-3 py-1 rounded-full text-sm font-bold transition-all ${
          memoMode ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-400'
        }`}>
          {memoMode ? '메모 ON' : '메모 OFF'}
        </div>
        <div className="flex items-center gap-1 text-sm">
          <span className="text-yellow-500">힌트</span>
          <span className="font-bold text-yellow-600">{MAX_HINTS - hintsUsed}남음</span>
        </div>
      </div>

      {/* 스도쿠 그리드 */}
      <div className="sudoku-grid">
        {grid.map((row, ri) =>
          row.map((cell, ci) => (
            <div
              key={`${ri}-${ci}`}
              className={getCellClass(ri, ci)}
              onClick={() => setSelected([ri, ci])}
            >
              {cell !== 0 ? (
                <span className="animate-bounce-in">{cell}</span>
              ) : memos[ri][ci].size > 0 ? (
                <div className="memo-grid">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                    <span key={n} className={`memo-num ${memos[ri][ci].has(n) ? 'visible' : ''}`}>
                      {memos[ri][ci].has(n) ? n : ''}
                    </span>
                  ))}
                </div>
              ) : ''}
            </div>
          ))
        )}
      </div>

      {/* 도구 버튼들 */}
      <div className="flex justify-center gap-2 sm:gap-3 mt-2 flex-wrap">
        <button
          onClick={handleUndo}
          disabled={history.length === 0}
          className="tool-btn disabled:opacity-30"
          title="실행취소 (Ctrl+Z)"
        >
          <span className="text-lg">↩️</span>
          <span className="text-xs">되돌리기</span>
        </button>
        <button
          onClick={() => {
            if (selected) {
              saveHistory();
              const [r, c] = selected;
              const newGrid = grid.map(row => [...row]);
              newGrid[r][c] = 0;
              setGrid(newGrid);
              setMemos(prev => {
                const next = prev.map(row => row.map(cell => new Set(cell)));
                next[r][c].clear();
                return next;
              });
            }
          }}
          className="tool-btn"
          title="지우기"
        >
          <span className="text-lg">🗑️</span>
          <span className="text-xs">지우기</span>
        </button>
        <button
          onClick={() => setMemoMode(prev => !prev)}
          className={`tool-btn ${memoMode ? 'tool-btn-active' : ''}`}
          title="메모 모드 (M)"
        >
          <span className="text-lg">📝</span>
          <span className="text-xs">메모</span>
        </button>
        <button
          onClick={handleHint}
          disabled={hintsUsed >= MAX_HINTS}
          className="tool-btn disabled:opacity-30"
          title="힌트"
        >
          <span className="text-lg">💡</span>
          <span className="text-xs">힌트 {MAX_HINTS - hintsUsed}</span>
        </button>
      </div>

      {/* 숫자 입력 패드 + 남은 개수 표시 */}
      <div className="num-pad mt-2">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
          <button
            key={num}
            className={`num-btn ${numberCounts[num] >= 9 ? 'num-btn-done' : ''} ${selectedNum === num ? 'num-btn-selected' : ''}`}
            onClick={() => handleInput(num)}
            disabled={numberCounts[num] >= 9}
          >
            <span className="num-btn-number">{num}</span>
            <span className="num-btn-count">{9 - numberCounts[num]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
