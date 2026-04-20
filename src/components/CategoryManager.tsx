import { useState } from 'react'
import { useAppStore } from '../domain/store'

export function CategoryManager({ onClose }: { onClose: () => void }) {
  const categories = useAppStore((s) => s.categories)
  const addCategory = useAppStore((s) => s.addCategory)
  const removeCategory = useAppStore((s) => s.removeCategory)

  const [name, setName] = useState('')
  const [color, setColor] = useState('#6b7280')

  const canAdd = name.trim().length > 0

  const handleAdd = () => {
    if (!canAdd) return
    addCategory({ name: name.trim(), color })
    setName('')
    setColor('#6b7280')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(7,8,10,0.75)] p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-none border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100"><span className="text-[#98c379]">$ </span>category --manage</h2>

        <ul className="mb-4 space-y-1 max-h-64 overflow-y-auto">
          {categories.length === 0 && (
            <li className="text-sm text-gray-500 dark:text-gray-400">카테고리가 없습니다.</li>
          )}
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-none px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800">
              <span className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200 font-mono">
                <span className="text-[#5c6370]">▸</span>
                <span className="inline-block h-3 w-3 rounded-none" style={{ backgroundColor: c.color }} />
                {c.name}
              </span>
              <button
                type="button"
                onClick={() => removeCategory(c.id)}
                className="rounded-none border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-700 font-mono hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >rm</button>
            </li>
          ))}
        </ul>

        <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-800">
          <label className="block">
            <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">--name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-none border border-gray-300 bg-white px-3 py-2 text-gray-900 font-mono dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">--color</span>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-20 rounded-none border border-gray-300 dark:border-gray-700"
            />
          </label>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className="w-full rounded-none border border-gray-900 bg-gray-900 px-4 py-2 text-sm text-white font-mono hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
          ><span className="opacity-70">$ </span>add</button>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-none border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 font-mono hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >close</button>
        </div>
      </div>
    </div>
  )
}
