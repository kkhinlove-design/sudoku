'use client';

import { useState, useEffect, useCallback, useRef, Suspense, use } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { generatePuzzle } from '@/lib/sudoku';
import SudokuBoard from '@/components/SudokuBoard';
import Timer from '@/components/Timer';
import Confetti from '@/components/Confetti';
import { startBGM, stopBGM } from '@/lib/sounds';

interface Player {
  id: string;
  name: string;
  avatar_emoji: string;
  games_played: number;
  games_won: number;
  total_score: number;
  current_level: number;
}

interface RoomPlayer {
  id: string;
  player_id: string;
  completion_pct: number;
  finished_at: string | null;
  is_winner: boolean;
  player?: Player;
}

interface Room {
  id: string;
  code: string;
  host_id: string;
  puzzle: number[][];
  solution: number[][];
  difficulty: string;
  status: string;
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: '쉬움 ⭐',
  medium: '보통 ⭐⭐',
  hard: '어려움 ⭐⭐⭐',
};

function RoomContent({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const playerId = searchParams.get('player');

  const [player, setPlayer] = useState<Player | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [roomPlayers, setRoomPlayers] = useState<RoomPlayer[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [difficulty, setDifficulty] = useState('easy');
  const [gameStarted, setGameStarted] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const [completionTime, setCompletionTime] = useState(0);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [bgmEnabled, setBgmEnabled] = useState(false);

  // BGM 제어
  useEffect(() => {
    if (bgmEnabled && gameStarted && !completed && !winner) {
      startBGM();
    } else {
      stopBGM();
    }
    return () => stopBGM();
  }, [bgmEnabled, gameStarted, completed, winner]);

  // roomId를 안정적인 ref로 관리 (구독 끊김 방지)
  const roomIdRef = useRef<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  roomRef.current = room;

  // 플레이어 로드
  useEffect(() => {
    if (!playerId) { router.push('/'); return; }
    supabase.from('players').select('*').eq('id', playerId).single().then(({ data }) => {
      if (data) setPlayer(data);
      else router.push('/');
    });
  }, [playerId, router]);

  // 참가자 목록 로드
  const loadPlayers = useCallback(async (rId: string) => {
    const { data } = await supabase
      .from('room_players')
      .select('*')
      .eq('room_id', rId);

    if (data) {
      const withPlayers = await Promise.all(
        data.map(async (rp) => {
          const { data: p } = await supabase
            .from('players')
            .select('*')
            .eq('id', rp.player_id)
            .single();
          return { ...rp, player: p || undefined };
        })
      );
      setRoomPlayers(withPlayers);
    }
  }, []);

  // 방 생성 또는 참가
  useEffect(() => {
    if (!player) return;

    const setupRoom = async () => {
      if (code === 'new') {
        const roomCode = generateRoomCode();
        const { puzzle, solution } = generatePuzzle('easy');

        const { data: newRoom, error: roomErr } = await supabase
          .from('rooms')
          .insert({
            code: roomCode,
            host_id: player.id,
            puzzle,
            solution,
            difficulty: 'easy',
            status: 'waiting',
          })
          .select()
          .single();

        if (roomErr || !newRoom) {
          setError('방 만들기 실패!');
          return;
        }

        await supabase.from('room_players').insert({
          room_id: newRoom.id,
          player_id: player.id,
        });

        roomIdRef.current = newRoom.id;
        setRoom(newRoom);
        setIsHost(true);
        window.history.replaceState(null, '', `/room/${roomCode}?player=${player.id}`);
      } else {
        const { data: existingRoom } = await supabase
          .from('rooms')
          .select('*')
          .eq('code', code.toUpperCase())
          .single();

        if (!existingRoom) {
          setError('방을 찾을 수 없어요! 코드를 확인해줘!');
          return;
        }

        roomIdRef.current = existingRoom.id;
        setRoom(existingRoom);
        setIsHost(existingRoom.host_id === player.id);

        if (existingRoom.status === 'playing') {
          setGameStarted(true);
        }

        // 참가자 등록
        await supabase.from('room_players').upsert(
          { room_id: existingRoom.id, player_id: player.id },
          { onConflict: 'room_id,player_id' }
        );

        // 참가 후 즉시 목록 새로고침
        await loadPlayers(existingRoom.id);
      }
    };

    setupRoom();
  }, [player, code, router, loadPlayers]);

  // 실시간 구독 (roomId 기반 - 안정적)
  useEffect(() => {
    const rId = roomIdRef.current;
    if (!rId) return;

    loadPlayers(rId);

    const channel = supabase
      .channel(`room-realtime-${rId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${rId}` },
        () => { loadPlayers(rId); }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${rId}` },
        (payload) => {
          const updated = payload.new as Room;
          setRoom(updated);
          if (updated.status === 'playing') setGameStarted(true);
          if (updated.status === 'finished') loadPlayers(rId);
        }
      )
      .subscribe();

    // 폴링 백업: 2초마다 방 상태 + 참가자 동기화
    const pollInterval = setInterval(async () => {
      const { data: latestRoom } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', rId)
        .single();

      if (latestRoom) {
        setRoom(latestRoom);
        if (latestRoom.status === 'playing') setGameStarted(true);
      }

      loadPlayers(rId);
    }, 2000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomIdRef.current, loadPlayers]);

  // 승자 감지
  useEffect(() => {
    const w = roomPlayers.find(rp => rp.is_winner);
    if (w && w.player) {
      setWinner(w.player.name);
      if (w.player_id === player?.id) setCompleted(true);
    }
  }, [roomPlayers, player]);

  // 게임 시작 (호스트만)
  const handleStart = async () => {
    if (!room || !isHost) return;
    const { puzzle, solution } = generatePuzzle(difficulty);

    await supabase.from('rooms').update({
      puzzle,
      solution,
      difficulty,
      status: 'playing',
      started_at: new Date().toISOString(),
    }).eq('id', room.id);

    await supabase.from('room_players').update({
      progress: [],
      completion_pct: 0,
      finished_at: null,
      is_winner: false,
    }).eq('room_id', room.id);

    setRoom(prev => prev ? { ...prev, puzzle, solution, difficulty, status: 'playing' } : null);
    setGameStarted(true);
    setCompleted(false);
    setWinner(null);
  };

  // 진행률 업데이트 (디바운스 적용)
  const progressTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleProgress = useCallback((grid: number[][], pct: number) => {
    const rId = roomIdRef.current;
    if (!rId || !player) return;

    // 로컬 즉시 반영
    setRoomPlayers(prev => prev.map(rp =>
      rp.player_id === player.id ? { ...rp, completion_pct: pct } : rp
    ));

    // DB 업데이트 디바운스 (300ms)
    if (progressTimeout.current) clearTimeout(progressTimeout.current);
    progressTimeout.current = setTimeout(async () => {
      await supabase.from('room_players').update({
        progress: grid,
        completion_pct: pct,
      }).eq('room_id', rId).eq('player_id', player.id);
    }, 300);
  }, [player]);

  // 완료 처리
  const handleComplete = useCallback(async (timeSeconds: number) => {
    const rId = roomIdRef.current;
    if (!rId || !player) return;
    setCompleted(true);
    setCompletionTime(timeSeconds);

    await supabase.from('room_players').update({
      completion_pct: 100,
      finished_at: new Date().toISOString(),
      is_winner: true,
    }).eq('room_id', rId).eq('player_id', player.id);

    await supabase.from('rooms').update({ status: 'finished' }).eq('id', rId);

    const currentRoom = roomRef.current;
    const diff = currentRoom?.difficulty || 'easy';
    const diffBonus = diff === 'easy' ? 150 : diff === 'medium' ? 300 : 500;
    const timeBonus = Math.max(0, 300 - timeSeconds);
    const totalScore = diffBonus + timeBonus;

    await supabase.from('players').update({
      games_played: (player as unknown as Record<string, number>).games_played + 1,
      games_won: (player as unknown as Record<string, number>).games_won + 1,
      total_score: (player as unknown as Record<string, number>).total_score + totalScore,
    }).eq('id', player.id);

    await supabase.from('game_history').insert({
      player_id: player.id,
      room_id: rId,
      difficulty: diff,
      completion_time: timeSeconds,
      is_winner: true,
      score: totalScore,
    });
  }, [player]);

  // 방 코드 복사
  const copyCode = () => {
    if (!room) return;
    navigator.clipboard.writeText(room.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="game-card text-center max-w-md">
          <div className="text-4xl mb-4">😢</div>
          <p className="text-lg text-purple-700 mb-4">{error}</p>
          <button onClick={() => router.push('/')} className="btn-primary">돌아가기</button>
        </div>
      </div>
    );
  }

  if (!room || !player) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-2xl text-purple-400">방 준비 중... 🧩</div>
      </div>
    );
  }

  // 승자 발표 화면
  if (winner) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        {completed && <Confetti />}
        <div className="game-card w-full max-w-md text-center">
          <div className="text-6xl mb-4">🏆</div>
          <h2 className="text-3xl font-bold text-purple-700 mb-2">
            {winner === player.name ? '내가 이겼다!' : `${winner}(이)가 이겼어!`}
          </h2>
          <div className="mt-4 space-y-2">
            {roomPlayers
              .sort((a, b) => b.completion_pct - a.completion_pct)
              .map((rp, idx) => (
                <div key={rp.id} className={`flex items-center gap-3 p-3 rounded-xl ${
                  rp.is_winner ? 'bg-yellow-50 border-2 border-yellow-300' : 'bg-gray-50'
                }`}>
                  <span className="text-lg font-bold text-purple-400">
                    {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`}
                  </span>
                  <span className="text-xl">{rp.player?.avatar_emoji}</span>
                  <span className="font-bold text-purple-700 flex-1 text-left">{rp.player?.name}</span>
                  <span className="text-sm text-purple-400">{rp.completion_pct}%</span>
                </div>
              ))}
          </div>
          <div className="flex flex-col gap-2 mt-6">
            {isHost && (
              <button onClick={() => { setWinner(null); setGameStarted(false); setCompleted(false); }} className="btn-primary w-full">
                다시 하기! 🔄
              </button>
            )}
            <button onClick={() => router.push('/')} className="btn-secondary w-full">로비로 돌아가기</button>
          </div>
        </div>
      </div>
    );
  }

  // 대기실
  if (!gameStarted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="game-card w-full max-w-md text-center">
          <div className="text-4xl mb-2">🏠</div>
          <h2 className="text-2xl font-bold text-purple-700 mb-1">대기실</h2>

          <div className="my-4 p-4 bg-purple-50 rounded-xl">
            <p className="text-sm text-purple-400 mb-1">방 코드를 친구에게 알려줘!</p>
            <div className="flex items-center justify-center gap-2">
              <span className="text-4xl font-black text-purple-700 tracking-widest">{room.code}</span>
              <button
                onClick={copyCode}
                className="px-3 py-1 bg-purple-200 rounded-lg text-purple-700 text-sm font-bold hover:bg-purple-300"
              >
                {copied ? '복사됨!' : '복사'}
              </button>
            </div>
          </div>

          <div className="mb-4">
            <p className="text-sm text-purple-400 mb-2 font-semibold">참가자 ({roomPlayers.length}명)</p>
            <div className="space-y-2">
              {roomPlayers.map(rp => (
                <div key={rp.id} className="flex items-center gap-3 p-2 bg-purple-50 rounded-xl">
                  <span className="text-2xl">{rp.player?.avatar_emoji}</span>
                  <span className="font-bold text-purple-700">{rp.player?.name}</span>
                  {rp.player_id === room.host_id && (
                    <span className="text-xs bg-yellow-200 text-yellow-700 px-2 py-0.5 rounded-full font-bold">방장</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {isHost && (
            <div className="mb-4">
              <p className="text-sm text-purple-400 mb-2 font-semibold">난이도 선택</p>
              <div className="flex gap-2 justify-center">
                {(['easy', 'medium', 'hard'] as const).map(diff => (
                  <button
                    key={diff}
                    onClick={() => setDifficulty(diff)}
                    className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
                      difficulty === diff
                        ? 'bg-purple-600 text-white scale-105'
                        : 'bg-purple-100 text-purple-600 hover:bg-purple-200'
                    }`}
                  >
                    {DIFFICULTY_LABELS[diff]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isHost ? (
            <button
              onClick={handleStart}
              disabled={roomPlayers.length < 1}
              className="btn-primary w-full text-lg disabled:opacity-50"
            >
              게임 시작! 🚀
            </button>
          ) : (
            <div className="text-purple-400 font-semibold animate-pulse">
              방장이 게임을 시작할 때까지 기다려줘...
            </div>
          )}

          <button onClick={() => router.push('/')} className="mt-3 text-sm text-purple-300 hover:text-purple-500">
            ← 나가기
          </button>
        </div>
      </div>
    );
  }

  // 게임 플레이
  return (
    <div className="min-h-screen p-2 sm:p-4 pt-4 sm:pt-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-bold text-purple-500">방: {room.code}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBgmEnabled(prev => !prev)}
              className={`px-2 py-1 rounded-full text-xs font-bold transition-all ${
                bgmEnabled ? 'bg-purple-500 text-white' : 'bg-gray-100 text-gray-400'
              }`}
            >
              {bgmEnabled ? '🔊' : '🔇'}
            </button>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-600">
              {DIFFICULTY_LABELS[room.difficulty]}
            </span>
          </div>
          <Timer running={!completed} />
        </div>

        <div className="game-card mb-4 p-3">
          <p className="text-xs text-purple-400 font-semibold mb-2">실시간 진행률</p>
          <div className="space-y-2">
            {roomPlayers.map(rp => (
              <div key={rp.id} className="flex items-center gap-2">
                <span className="text-lg">{rp.player?.avatar_emoji}</span>
                <span className="text-sm font-bold text-purple-700 w-16 truncate">{rp.player?.name}</span>
                <div className="progress-bar flex-1">
                  <div className="progress-fill" style={{ width: `${rp.completion_pct}%` }} />
                </div>
                <span className="text-xs font-bold text-purple-500 w-10 text-right">{rp.completion_pct}%</span>
              </div>
            ))}
          </div>
        </div>

        <SudokuBoard
          puzzle={room.puzzle}
          solution={room.solution}
          onProgress={handleProgress}
          onComplete={handleComplete}
        />
      </div>
    </div>
  );
}

export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="text-2xl text-purple-400">로딩 중... 🧩</div></div>}>
      <RoomContent params={params} />
    </Suspense>
  );
}
