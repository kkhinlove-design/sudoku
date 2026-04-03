'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { generatePuzzle } from '@/lib/sudoku';
import SudokuBoard from '@/components/SudokuBoard';
import Timer from '@/components/Timer';
import Confetti from '@/components/Confetti';
import { startBGM, stopBGM } from '@/lib/sounds';

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: '쉬움 ⭐',
  medium: '보통 ⭐⭐',
  hard: '어려움 ⭐⭐⭐',
};

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  hard: 'bg-red-100 text-red-700',
};

function PlayContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const playerId = searchParams.get('player');

  const [player, setPlayer] = useState<{ id: string; name: string; avatar_emoji: string; current_level: number; games_played: number; games_won: number; total_score: number } | null>(null);
  const [difficulty, setDifficulty] = useState<string | null>(null);
  const [puzzle, setPuzzle] = useState<number[][] | null>(null);
  const [solution, setSolution] = useState<number[][] | null>(null);
  const [completed, setCompleted] = useState(false);
  const [completionTime, setCompletionTime] = useState(0);
  const [score, setScore] = useState(0);
  const [bgmEnabled, setBgmEnabled] = useState(false);

  // BGM 제어
  useEffect(() => {
    if (bgmEnabled && difficulty && !completed) {
      startBGM();
    } else {
      stopBGM();
    }
    return () => stopBGM();
  }, [bgmEnabled, difficulty, completed]);

  useEffect(() => {
    if (!playerId) { router.push('/'); return; }
    supabase.from('players').select('*').eq('id', playerId).single().then(({ data }) => {
      if (data) setPlayer(data);
      else router.push('/');
    });
  }, [playerId, router]);

  const startGame = (diff: string) => {
    const { puzzle: p, solution: s } = generatePuzzle(diff);
    setDifficulty(diff);
    setPuzzle(p);
    setSolution(s);
    setCompleted(false);
  };

  const handleComplete = useCallback(async (timeSeconds: number) => {
    setCompleted(true);
    setCompletionTime(timeSeconds);

    // 점수 계산: 난이도 보너스 + 시간 보너스
    const diffBonus = difficulty === 'easy' ? 100 : difficulty === 'medium' ? 200 : 300;
    const timeBonus = Math.max(0, 300 - timeSeconds);
    const totalScore = diffBonus + timeBonus;
    setScore(totalScore);

    if (!player) return;

    // 플레이어 통계 업데이트
    const updates: Record<string, unknown> = {
      games_played: (player as unknown as Record<string, number>).games_played + 1,
      games_won: (player as unknown as Record<string, number>).games_won + 1,
      total_score: (player as unknown as Record<string, number>).total_score + totalScore,
    };

    // 레벨업: 3게임마다
    if ((updates.games_played as number) % 3 === 0) {
      updates.current_level = player.current_level + 1;
    }

    // 최고 기록 업데이트
    const bestKey = `best_time_${difficulty}` as string;
    const currentBest = (player as unknown as Record<string, number | null>)[bestKey];
    if (!currentBest || timeSeconds < currentBest) {
      updates[bestKey] = timeSeconds;
    }

    await supabase.from('players').update(updates).eq('id', player.id);

    // 게임 기록 저장
    await supabase.from('game_history').insert({
      player_id: player.id,
      difficulty,
      completion_time: timeSeconds,
      is_winner: true,
      score: totalScore,
    });
  }, [difficulty, player]);

  if (!player) return null;

  // 난이도 선택 화면
  if (!difficulty) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="game-card w-full max-w-md text-center">
          <div className="text-4xl mb-2">{player.avatar_emoji}</div>
          <h2 className="text-2xl font-bold text-purple-700 mb-1">{player.name}의 연습</h2>
          <p className="text-purple-400 mb-6">난이도를 골라봐!</p>

          <div className="flex flex-col gap-3">
            {(['easy', 'medium', 'hard'] as const).map(diff => (
              <button
                key={diff}
                onClick={() => startGame(diff)}
                className={`py-4 rounded-xl font-bold text-lg transition-all hover:scale-105 ${DIFFICULTY_COLORS[diff]}`}
              >
                {DIFFICULTY_LABELS[diff]}
              </button>
            ))}
          </div>

          <button
            onClick={() => router.push('/')}
            className="mt-4 text-purple-400 hover:text-purple-600"
          >
            ← 돌아가기
          </button>
        </div>
      </div>
    );
  }

  // 완료 화면
  if (completed) {
    const mins = Math.floor(completionTime / 60);
    const secs = completionTime % 60;
    const newGamesPlayed = player.games_played + 1;
    const didLevelUp = newGamesPlayed % 3 === 0;
    const newLevel = didLevelUp ? player.current_level + 1 : player.current_level;
    const gamesInLevel = didLevelUp ? 0 : newGamesPlayed % 3;
    const levelProgress = (gamesInLevel / 3) * 100;

    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Confetti />
        <div className="game-card w-full max-w-md text-center animate-bounce-in">
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-3xl font-bold text-purple-700 mb-2">축하해요!</h2>
          <p className="text-lg text-purple-500 mb-4">
            {player.name}(이)가 스도쿠를 완성했어요!
          </p>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-purple-50 rounded-xl p-3">
              <div className="text-sm text-purple-400">걸린 시간</div>
              <div className="text-xl font-bold text-purple-700">
                {mins}분 {secs}초
              </div>
            </div>
            <div className="bg-pink-50 rounded-xl p-3">
              <div className="text-sm text-pink-400">획득 점수</div>
              <div className="text-xl font-bold text-pink-700">
                +{score}점
              </div>
            </div>
          </div>

          {/* 레벨업 바 */}
          <div className="mb-6 px-2">
            {didLevelUp ? (
              <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-4 animate-bounce-in">
                <div className="text-2xl mb-1">🎖️</div>
                <div className="text-lg font-bold text-yellow-600">레벨 업!</div>
                <div className="text-3xl font-black text-purple-700 my-1">
                  Lv.{player.current_level} → Lv.{newLevel}
                </div>
                <div className="progress-bar mt-2" style={{ height: '10px' }}>
                  <div
                    className="progress-fill"
                    style={{ width: '100%', transition: 'width 1s ease' }}
                  />
                </div>
                <div className="text-xs text-purple-400 mt-1">다음 레벨까지 3게임</div>
              </div>
            ) : (
              <div className="bg-purple-50 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-purple-600">Lv.{newLevel}</span>
                  <span className="text-xs text-purple-400">다음 레벨까지 {3 - gamesInLevel}게임</span>
                  <span className="text-sm font-bold text-purple-400">Lv.{newLevel + 1}</span>
                </div>
                <div className="progress-bar" style={{ height: '10px' }}>
                  <div
                    className="progress-fill"
                    style={{ width: `${levelProgress}%`, transition: 'width 1s ease' }}
                  />
                </div>
                <div className="text-xs text-purple-400 mt-1">{gamesInLevel}/3 게임 완료</div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <button onClick={() => startGame(difficulty)} className="btn-primary w-full">
              한 번 더! 💪
            </button>
            <button onClick={() => setDifficulty(null)} className="btn-secondary w-full">
              난이도 변경
            </button>
            <button
              onClick={() => router.push('/')}
              className="text-purple-400 hover:text-purple-600 mt-1"
            >
              ← 로비로
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 게임 플레이 화면
  return (
    <div className="min-h-screen p-2 sm:p-4 pt-4 sm:pt-6">
      <div className="max-w-2xl mx-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => { setDifficulty(null); setPuzzle(null); }}
            className="text-purple-400 hover:text-purple-600 font-semibold"
          >
            ← 뒤로
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBgmEnabled(prev => !prev)}
              className={`px-3 py-1 rounded-full text-sm font-bold transition-all ${
                bgmEnabled ? 'bg-purple-500 text-white' : 'bg-gray-100 text-gray-400'
              }`}
              title="배경음악"
            >
              {bgmEnabled ? '🔊 BGM' : '🔇 BGM'}
            </button>
            <span className={`px-3 py-1 rounded-full text-sm font-bold ${DIFFICULTY_COLORS[difficulty]}`}>
              {DIFFICULTY_LABELS[difficulty]}
            </span>
          </div>
          <Timer running={!completed} />
        </div>

        {/* 레벨 바 */}
        <div className="flex items-center gap-2 mb-3 px-1">
          <span className="text-xs font-bold text-purple-600 shrink-0">Lv.{player.current_level}</span>
          <div className="progress-bar flex-1" style={{ height: '8px' }}>
            <div
              className="progress-fill"
              style={{ width: `${((player.games_played % 3) / 3) * 100}%` }}
            />
          </div>
          <span className="text-xs font-bold text-purple-400 shrink-0">Lv.{player.current_level + 1}</span>
        </div>

        {/* 보드 */}
        {puzzle && solution && (
          <SudokuBoard
            puzzle={puzzle}
            solution={solution}
            onComplete={handleComplete}
          />
        )}
      </div>
    </div>
  );
}

export default function PlayPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="text-2xl text-purple-400">로딩 중...</div></div>}>
      <PlayContent />
    </Suspense>
  );
}
