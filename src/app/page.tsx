'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

const AVATARS = ['😊', '🦊', '🐱', '🐶', '🐰', '🐼', '🦁', '🐸', '🐵', '🦄', '🐯', '🐮'];

interface Player {
  id: string;
  name: string;
  avatar_emoji: string;
  games_played: number;
  games_won: number;
  total_score: number;
  current_level: number;
  best_time_easy: number | null;
  best_time_medium: number | null;
  best_time_hard: number | null;
  created_at: string;
}

function formatTime(seconds: number | null): string {
  if (!seconds) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('😊');
  const [player, setPlayer] = useState<Player | null>(null);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 등록된 플레이어 목록 로드
  const loadAllPlayers = async () => {
    const { data } = await supabase
      .from('players')
      .select('*')
      .order('total_score', { ascending: false });
    if (data) setAllPlayers(data);
  };

  // 초기 로드
  useEffect(() => {
    // 로컬스토리지에서 복원
    const saved = localStorage.getItem('sudoku_player_id');
    if (saved) {
      supabase.from('players').select('*').eq('id', saved).single().then(({ data }) => {
        if (data) setPlayer(data);
      });
    }
    loadAllPlayers();
  }, []);

  // 새 이름 등록 & 로그인
  const handleLogin = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError('');

    try {
      const { data: existing } = await supabase
        .from('players')
        .select('*')
        .eq('name', name.trim())
        .single();

      if (existing) {
        await supabase.from('players').update({ avatar_emoji: selectedAvatar }).eq('id', existing.id);
        existing.avatar_emoji = selectedAvatar;
        setPlayer(existing);
        localStorage.setItem('sudoku_player_id', existing.id);
      } else {
        const { data: newPlayer, error: insertErr } = await supabase
          .from('players')
          .insert({ name: name.trim(), avatar_emoji: selectedAvatar })
          .select()
          .single();

        if (insertErr) throw insertErr;
        setPlayer(newPlayer);
        localStorage.setItem('sudoku_player_id', newPlayer.id);
        // 목록 새로고침
        loadAllPlayers();
      }
    } catch {
      setError('이름을 다시 확인해주세요!');
    } finally {
      setLoading(false);
    }
  };

  // 기존 플레이어 선택 로그인
  const handleSelectPlayer = (p: Player) => {
    setPlayer(p);
    localStorage.setItem('sudoku_player_id', p.id);
  };

  // 친구 삭제
  const handleDeletePlayer = async (e: React.MouseEvent, p: Player) => {
    e.stopPropagation(); // 버튼 클릭이 부모 버튼(선택)에 전달되지 않게
    if (!confirm(`정말 "${p.name}"을(를) 삭제할까요?\n게임 기록도 함께 삭제돼요!`)) return;

    // 게임 기록 삭제
    await supabase.from('game_history').delete().eq('player_id', p.id);
    // 방 참가 기록 삭제
    await supabase.from('room_players').delete().eq('player_id', p.id);
    // 플레이어 삭제
    await supabase.from('players').delete().eq('id', p.id);

    // 현재 로그인된 플레이어가 삭제된 경우 로그아웃
    if (player?.id === p.id) {
      setPlayer(null);
      localStorage.removeItem('sudoku_player_id');
    }

    // 목록 새로고침
    loadAllPlayers();
  };

  // 방 만들기
  const handleCreateRoom = () => {
    if (!player) return;
    router.push(`/room/new?player=${player.id}`);
  };

  // 방 참가
  const handleJoinRoom = () => {
    if (!player || !roomCode.trim()) return;
    router.push(`/room/${roomCode.trim().toUpperCase()}?player=${player.id}`);
  };

  // 혼자 하기
  const handleSoloPlay = () => {
    if (!player) return;
    router.push(`/play?player=${player.id}`);
  };

  // 로그아웃
  const handleLogout = () => {
    setPlayer(null);
    setName('');
    localStorage.removeItem('sudoku_player_id');
    loadAllPlayers();
  };

  // ─── 로그인 전 화면 ───
  if (!player) {
    return (
      <div className="min-h-screen p-4 py-8">
        <div className="max-w-md mx-auto">
          {/* 타이틀 카드 */}
          <div className="game-card text-center mb-4">
            <div className="text-6xl mb-3">🧩</div>
            <h1 className="text-3xl font-bold text-purple-700 mb-1">
              은우의 스도쿠
            </h1>
            <p className="text-purple-400 mb-5">친구들과 함께 즐기는 스도쿠!</p>

            {/* 아바타 선택 */}
            <div className="mb-4">
              <p className="text-sm text-purple-500 mb-2 font-semibold">캐릭터를 골라봐!</p>
              <div className="flex flex-wrap justify-center gap-2">
                {AVATARS.map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => setSelectedAvatar(emoji)}
                    className={`text-2xl p-2 rounded-xl transition-all ${
                      selectedAvatar === emoji
                        ? 'bg-purple-100 scale-125 shadow-md'
                        : 'hover:bg-purple-50'
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            {/* 이름 입력 */}
            <div className="mb-4">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="새 이름을 입력해줘! (예: 은우)"
                className="w-full px-4 py-3 rounded-xl border-2 border-purple-200 focus:border-purple-500 focus:outline-none text-center text-lg font-semibold"
                maxLength={10}
              />
            </div>

            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

            <button
              onClick={handleLogin}
              disabled={loading || !name.trim()}
              className="btn-primary w-full disabled:opacity-50"
            >
              {loading ? '접속 중...' : `${selectedAvatar} 새로 시작하기!`}
            </button>
          </div>

          {/* 등록된 친구 목록 */}
          {allPlayers.length > 0 && (
            <div className="game-card">
              <h3 className="text-lg font-bold text-purple-700 mb-3 text-center">
                등록된 친구들 ({allPlayers.length}명)
              </h3>
              <p className="text-xs text-purple-400 text-center mb-3">
                이름을 눌러서 바로 접속해요!
              </p>

              <div className="space-y-2">
                {allPlayers.map((p, idx) => (
                  <div key={p.id} className="relative group">
                  <button
                    onClick={() => handleSelectPlayer(p)}
                    className="w-full text-left p-3 rounded-xl border-2 border-purple-100 hover:border-purple-400 hover:bg-purple-50 transition-all"
                  >
                    <div className="flex items-center gap-3">
                      {/* 순위 */}
                      <span className="text-lg w-6 text-center">
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`}
                      </span>

                      {/* 아바타 */}
                      <span className="text-3xl">{p.avatar_emoji}</span>

                      {/* 정보 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-purple-700 text-base">{p.name}</span>
                          <span className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full font-semibold">
                            Lv.{p.current_level}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-purple-400">
                          <span>{p.games_played}게임</span>
                          <span className="text-green-500 font-semibold">{p.games_won}승</span>
                          <span className="text-red-400">{p.games_played - p.games_won}패</span>
                          <span className="text-yellow-500 font-bold">{p.total_score}점</span>
                        </div>
                      </div>

                      {/* 최고기록 */}
                      <div className="text-right text-xs text-purple-300 shrink-0">
                        {p.best_time_easy && (
                          <div>쉬움 {formatTime(p.best_time_easy)}</div>
                        )}
                        {p.best_time_medium && (
                          <div>보통 {formatTime(p.best_time_medium)}</div>
                        )}
                        {p.best_time_hard && (
                          <div>어려움 {formatTime(p.best_time_hard)}</div>
                        )}
                      </div>
                    </div>

                    {/* 승률 바 */}
                    {p.games_played > 0 && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs text-purple-400 mb-1">
                          <span>승률</span>
                          <span>{Math.round((p.games_won / p.games_played) * 100)}%</span>
                        </div>
                        <div className="progress-bar" style={{ height: '6px' }}>
                          <div
                            className="progress-fill"
                            style={{ width: `${(p.games_won / p.games_played) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* 레벨업 바 */}
                    <div className="mt-2">
                      <div className="flex items-center gap-1 text-xs text-purple-400 mb-1">
                        <span className="font-bold text-purple-600">Lv.{Math.min(p.current_level, 99)}</span>
                        <div className="progress-bar flex-1" style={{ height: '5px' }}>
                          <div
                            className="progress-fill"
                            style={{ width: `${((p.games_played % 3) / 3) * 100}%` }}
                          />
                        </div>
                        <span className="text-purple-400">Lv.{Math.min(p.current_level + 1, 99)}</span>
                      </div>
                    </div>
                  </button>
                  {/* 삭제 버튼 */}
                  <button
                    onClick={(e) => handleDeletePlayer(e, p)}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-red-100 text-red-400 hover:bg-red-200 hover:text-red-600 flex items-center justify-center text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity"
                    title={`${p.name} 삭제`}
                  >
                    ✕
                  </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── 로그인 후 로비 ───
  return (
    <div className="min-h-screen p-4 py-8">
      <div className="max-w-md mx-auto">
        <div className="game-card mb-4">
          {/* 프로필 */}
          <div className="text-center mb-5">
            <div className="text-5xl mb-2">{player.avatar_emoji}</div>
            <h2 className="text-2xl font-bold text-purple-700">{player.name}</h2>
            <div className="flex justify-center gap-3 mt-2 text-sm text-purple-400">
              <span>Lv.{player.current_level}</span>
              <span>|</span>
              <span>{player.games_played}게임</span>
              <span>|</span>
              <span className="text-green-500 font-semibold">{player.games_won}승</span>
              <span className="text-red-400">{player.games_played - player.games_won}패</span>
            </div>
            <div className="mt-2">
              <span className="text-yellow-500 font-bold text-lg">{player.total_score}점</span>
            </div>

            {/* 최고 기록 */}
            <div className="flex justify-center gap-4 mt-3">
              {[
                { label: '쉬움', time: player.best_time_easy, color: 'green' },
                { label: '보통', time: player.best_time_medium, color: 'yellow' },
                { label: '어려움', time: player.best_time_hard, color: 'red' },
              ].map(({ label, time, color }) => (
                <div key={label} className={`text-center px-3 py-2 rounded-xl bg-${color}-50`}>
                  <div className={`text-xs text-${color}-500 font-semibold`}>{label}</div>
                  <div className={`text-sm font-bold text-${color}-600`}>
                    {formatTime(time)}
                  </div>
                </div>
              ))}
            </div>

            {/* 승률 바 */}
            {player.games_played > 0 && (
              <div className="mt-3 px-4">
                <div className="flex justify-between text-xs text-purple-400 mb-1">
                  <span>승률</span>
                  <span>{Math.round((player.games_won / player.games_played) * 100)}%</span>
                </div>
                <div className="progress-bar" style={{ height: '8px' }}>
                  <div
                    className="progress-fill"
                    style={{ width: `${(player.games_won / player.games_played) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* 레벨업 바 */}
            <div className="mt-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-bold text-purple-600">Lv.{Math.min(player.current_level, 99)}</span>
                <div className="progress-bar flex-1" style={{ height: '8px' }}>
                  <div
                    className="progress-fill"
                    style={{ width: `${((player.games_played % 3) / 3) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-bold text-purple-400">Lv.{Math.min(player.current_level + 1, 99)}</span>
              </div>
              <div className="text-xs text-purple-400 text-center">
                다음 레벨까지 {3 - (player.games_played % 3)}게임
              </div>
            </div>
          </div>

          {/* 메뉴 */}
          <div className="flex flex-col gap-3">
            <button onClick={handleSoloPlay} className="btn-primary w-full text-lg">
              🎮 혼자 연습하기
            </button>

            <button onClick={handleCreateRoom} className="btn-secondary w-full text-lg">
              🏠 방 만들기
            </button>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
                placeholder="방 코드 입력"
                className="w-full sm:flex-1 px-4 py-3 rounded-xl border-2 border-pink-200 focus:border-pink-500 focus:outline-none text-center font-bold text-lg uppercase"
                maxLength={4}
              />
              <button
                onClick={handleJoinRoom}
                disabled={!roomCode.trim()}
                className="btn-secondary disabled:opacity-50 w-full sm:w-auto px-6"
              >
                입장!
              </button>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="mt-4 text-sm text-purple-300 hover:text-purple-500 w-full text-center"
          >
            다른 이름으로 접속하기
          </button>
        </div>

        {/* 전체 랭킹 */}
        {allPlayers.length > 1 && (
          <div className="game-card">
            <h3 className="text-lg font-bold text-purple-700 mb-3 text-center">
              친구들 랭킹
            </h3>
            <div className="space-y-2">
              {allPlayers.map((p, idx) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 p-2 rounded-xl ${
                    p.id === player.id ? 'bg-purple-100 border-2 border-purple-300' : 'bg-gray-50'
                  }`}
                >
                  <span className="text-lg w-6 text-center">
                    {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`}
                  </span>
                  <span className="text-2xl">{p.avatar_emoji}</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-bold text-purple-700">{p.name}</span>
                    <span className="text-xs text-purple-400 ml-2">Lv.{p.current_level}</span>
                  </div>
                  <div className="text-right text-xs">
                    <div className="font-bold text-yellow-500">{p.total_score}점</div>
                    <div className="text-purple-400">
                      {p.games_won}승 {p.games_played - p.games_won}패
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
