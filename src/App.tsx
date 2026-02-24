import React, { useCallback, useEffect, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// --- Types ---

interface DutyItem {
  id: string
  day: string
  member: string
}

interface SwaClientPrincipal {
  userDetails: string
  identityProvider: string
  userId: string
  userRoles: string[]
}

// --- Initial Data ---

const INITIAL_DUTIES: DutyItem[] = [
  { id: 'mon', day: '月曜日', member: '田中 太郎' },
  { id: 'tue', day: '火曜日', member: '鈴木 花子' },
  { id: 'wed', day: '水曜日', member: '佐藤 一郎' },
  { id: 'thu', day: '木曜日', member: '山田 美咲' },
  { id: 'fri', day: '金曜日', member: '伊藤 健二' },
]

// --- SortableCard component ---

function SortableCard({ item }: { item: DutyItem }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 999 : 'auto',
    position: 'relative',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={[
        'flex items-center justify-between',
        'bg-white border-2 rounded-xl p-4 mb-3',
        'shadow-sm select-none cursor-grab active:cursor-grabbing',
        'transition-all duration-150',
        isDragging
          ? 'border-indigo-400 shadow-xl scale-105'
          : 'border-gray-200 hover:border-indigo-200 hover:shadow-md',
      ].join(' ')}
    >
      {/* Drag handle indicator */}
      <div className="flex flex-col gap-0.5 text-gray-300 mr-3 shrink-0">
        <div className="w-5 h-0.5 bg-gray-300 rounded" />
        <div className="w-5 h-0.5 bg-gray-300 rounded" />
        <div className="w-5 h-0.5 bg-gray-300 rounded" />
      </div>

      {/* Day label */}
      <span className="font-semibold text-gray-500 w-20 shrink-0 text-sm">
        {item.day}
      </span>

      {/* Member name */}
      <span className="flex-1 text-gray-800 font-medium text-base">
        {item.member}
      </span>

      {/* Arrow indicator */}
      <span className="text-gray-300 text-lg ml-2">⇅</span>
    </div>
  )
}

// --- Main App ---

type SaveStatus = 'idle' | 'saving' | 'success' | 'error'

export default function App() {
  const [duties, setDuties] = useState<DutyItem[]>(INITIAL_DUTIES)
  const [username, setUsername] = useState<string>('読み込み中...')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string>('')

  // Fetch logged-in user from SWA built-in auth endpoint.
  // /.auth/me は SWA CLI (port 4280) または本番環境でのみ有効。
  // Vite 直接 (port 5173) では 404 が返るためフォールバックメッセージを表示する。
  useEffect(() => {
    fetch('/.auth/me')
      .then(async (res) => {
        if (!res.ok) {
          setUsername('（ローカル開発中）')
          return
        }
        const data: { clientPrincipal: SwaClientPrincipal | null } =
          await res.json()
        if (data.clientPrincipal) {
          setUsername(data.clientPrincipal.userDetails)
        } else {
          setUsername('未認証')
        }
      })
      .catch(() => setUsername('（ローカル開発中）'))
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        // 5px動かさないとドラッグ開始しない（クリック誤操作を防止）
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setDuties((prev) => {
        const oldIndex = prev.findIndex((d) => d.id === active.id)
        const newIndex = prev.findIndex((d) => d.id === over.id)
        return arrayMove(prev, oldIndex, newIndex)
      })
    }
  }, [])

  const handleSave = async () => {
    setSaveStatus('saving')
    setErrorMessage('')
    try {
      const res = await fetch('/api/saveDuty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duties: duties.map(({ id, day, member }) => ({ id, day, member })),
        }),
      })
      if (res.ok) {
        setSaveStatus('success')
        setTimeout(() => setSaveStatus('idle'), 3000)
      } else {
        const text = await res.text()
        setErrorMessage(`サーバーエラー: ${res.status} ${text}`)
        setSaveStatus('error')
      }
    } catch {
      setErrorMessage('ネットワークエラーが発生しました')
      setSaveStatus('error')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-1">
            給湯室当番表
          </h1>
          <p className="text-gray-500 text-sm">
            ログイン中:{' '}
            <span className="font-medium text-indigo-600">{username}</span>
          </p>
          <p className="text-gray-400 text-xs mt-1">
            カードをドラッグして順番を並び替えてください
          </p>
        </div>

        {/* Sortable duty list */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={duties.map((d) => d.id)}
            strategy={verticalListSortingStrategy}
          >
            {duties.map((item) => (
              <SortableCard key={item.id} item={item} />
            ))}
          </SortableContext>
        </DndContext>

        {/* Save button */}
        <div className="mt-6">
          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className={[
              'w-full py-3 px-6 rounded-xl font-semibold text-white text-lg',
              'transition-all duration-200',
              saveStatus === 'saving'
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 shadow-md hover:shadow-lg',
            ].join(' ')}
          >
            {saveStatus === 'saving' ? '保存中...' : '当番表を保存'}
          </button>

          {saveStatus === 'success' && (
            <div className="mt-3 p-3 bg-green-100 border border-green-300 rounded-lg text-green-700 text-sm text-center">
              ✓ 保存しました
            </div>
          )}

          {saveStatus === 'error' && (
            <div className="mt-3 p-3 bg-red-100 border border-red-300 rounded-lg text-red-700 text-sm text-center">
              {errorMessage}
            </div>
          )}
        </div>

        {/* Current order preview */}
        <div className="mt-8 p-4 bg-white/60 rounded-xl border border-gray-200">
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
            現在の当番順
          </p>
          <ol className="list-decimal list-inside space-y-1">
            {duties.map((d) => (
              <li key={d.id} className="text-sm text-gray-700">
                <span className="text-gray-400">{d.day}</span>：{d.member}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}
