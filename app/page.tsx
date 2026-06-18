"use client"

import React, { useState, useEffect, useCallback } from "react"
import { createClient } from "@supabase/supabase-js"
import { addDays, format, isSameDay, isBefore, setHours, setMinutes, startOfDay } from "date-fns"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

// ─── Supabase client ───────────────────────────────────────────────────────────
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ─── Constants ─────────────────────────────────────────────────────────────────
const HOURS = Array.from({ length: 24 }, (_, i) => {
  const ampm = i >= 12 ? "PM" : "AM"
  const hour = i % 12 === 0 ? 12 : i % 12
  return `${hour}:00 ${ampm}`
})

const CATEGORIES = [
  {
    id: "solar_100w",
    label: "100W Solar",
    color: "bg-amber-500",
    colorReserved: "bg-amber-500 hover:bg-amber-600",
    colorSelected: "bg-amber-300 ring-2 ring-amber-400 ring-inset",
    colorHover: "hover:bg-amber-50",
    dotColor: "bg-amber-500",
    textColor: "text-amber-700",
    borderColor: "border-amber-300",
    bgLight: "bg-amber-50",
  },
  {
    id: "solar_300w",
    label: "300W Solar",
    color: "bg-orange-500",
    colorReserved: "bg-orange-500 hover:bg-orange-600",
    colorSelected: "bg-orange-300 ring-2 ring-orange-400 ring-inset",
    colorHover: "hover:bg-orange-50",
    dotColor: "bg-orange-500",
    textColor: "text-orange-700",
    borderColor: "border-orange-300",
    bgLight: "bg-orange-50",
  },
  {
    id: "grey_reactor",
    label: "Illumin8 Parallel Photoreactor",
    sublabel: "Grey Reactor",
    color: "bg-slate-500",
    colorReserved: "bg-slate-500 hover:bg-slate-600",
    colorSelected: "bg-slate-300 ring-2 ring-slate-400 ring-inset",
    colorHover: "hover:bg-slate-50",
    dotColor: "bg-slate-500",
    textColor: "text-slate-700",
    borderColor: "border-slate-300",
    bgLight: "bg-slate-50",
  },
  {
    id: "blue_reactor",
    label: "PhotoRedOx Box",
    sublabel: "Blue Reactor",
    color: "bg-blue-500",
    colorReserved: "bg-blue-500 hover:bg-blue-600",
    colorSelected: "bg-blue-300 ring-2 ring-blue-400 ring-inset",
    colorHover: "hover:bg-blue-50",
    dotColor: "bg-blue-500",
    textColor: "text-blue-700",
    borderColor: "border-blue-300",
    bgLight: "bg-slate-50",
  },
] as const

type CategoryId = (typeof CATEGORIES)[number]["id"]

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Reservation {
  id: string
  user_name: string
  password_hash: string
  date_key: string
  hour_idx: number
  category_id: CategoryId
}

type Schedule = Record<string, Record<string, Record<number, Reservation>>>

interface SelectedSlot {
  dateKey: string
  hourIdx: number
  dateObj: Date
}

async function hashPassword(pw: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// ─── Component ─────────────────────────────────────────────────────────────────
export default function RollingTimelineBooking() {
  const [activeCategory, setActiveCategory] = useState<CategoryId>("solar_100w")
  const [dayOffset, setDayOffset] = useState<number>(0)
  const [schedule, setSchedule] = useState<Schedule>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Booking modal
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false)
  const [selectedSlots, setSelectedSlots] = useState<SelectedSlot[]>([])
  const [inputName, setInputName] = useState("")
  const [inputPassword, setInputPassword] = useState("")

  // Cancel modal
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<{ dateKey: string; hourIdx: number } | null>(null)
  const [cancelPassword, setCancelPassword] = useState("")
  const [cancelError, setCancelError] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  
  // Multiple cancellations tracking state
  const [slotsToCancel, setSlotsToCancel] = useState<Reservation[]>([])

  const today = startOfDay(new Date())
  const currentSunday = addDays(today, -today.getDay())

  const daysOfWeek = Array.from({ length: 7 }, (_, i) => {
    const dayDate = addDays(currentSunday, i + dayOffset)
    return {
      name: format(dayDate, "EEEE"),
      dateLabel: format(dayDate, "MM/dd/yyyy"),
      dbKey: format(dayDate, "yyyy-MM-dd"),
      isToday: isSameDay(dayDate, new Date()),
      rawDate: dayDate,
    }
  })

  // ── Parse DB rows into nested schedule state ──
  const applyRows = useCallback((rows: Reservation[]) => {
    setSchedule((prev) => {
      const next: Schedule = { ...prev }
      for (const cat of CATEGORIES) {
        next[cat.id] = next[cat.id] ? { ...next[cat.id] } : {}
      }
      for (const row of rows) {
        if (!next[row.category_id]) next[row.category_id] = {}
        if (!next[row.category_id][row.date_key]) next[row.category_id][row.date_key] = {}
        next[row.category_id][row.date_key][row.hour_idx] = row
      }
      return next
    })
  }, [])

  const removeRow = useCallback((row: Partial<Reservation> & { category_id: CategoryId; date_key: string; hour_idx: number }) => {
    setSchedule((prev) => {
      const next = { ...prev }
      if (next[row.category_id]?.[row.date_key]) {
        const dayMap = { ...next[row.category_id][row.date_key] }
        delete dayMap[row.hour_idx]
        next[row.category_id] = { ...next[row.category_id], [row.date_key]: dayMap }
      }
      return next
    })
  }, [])

  // ── Initial load ──
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from("reservations")
        .select("*")
      if (!error && data) applyRows(data as Reservation[])
      setLoading(false)
    }
    fetchAll()
  }, [applyRows])

  // ── Real-time subscription ──
  useEffect(() => {
    const channel = supabase
      .channel("reservations-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reservations" },
        (payload) => applyRows([payload.new as Reservation])
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "reservations" },
        (payload) => {
          const oldRow = payload.old as Reservation
          if (oldRow && oldRow.category_id) {
            removeRow(oldRow)
          } else if (payload.errors === null) {
            supabase.from("reservations").select("*").then(({ data }) => {
              if (data) applyRows(data as Reservation[])
            })
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [applyRows, removeRow])

  // ── Helpers ──
  const handleNextPeriod = () => setDayOffset((prev) => prev + 7)
  const handlePrevPeriod = () => setDayOffset((prev) => prev - 7)

  const isSlotPast = (dayDate: Date, hourIdx: number) => {
    const slotDateTime = setMinutes(setHours(new Date(dayDate), hourIdx), 0)
    return isBefore(slotDateTime, new Date())
  }

  const isSlotSelected = (dateKey: string, hourIdx: number) =>
    selectedSlots.some((s) => s.dateKey === dateKey && s.hourIdx === hourIdx)

  const handleCellClick = (dateKey: string, hourIdx: number, dayDate: Date) => {
    if (isSlotPast(dayDate, hourIdx)) return
    const booking = schedule[activeCategory]?.[dateKey]?.[hourIdx]
    
    if (booking) {
      setCancelTarget({ dateKey, hourIdx })
      setCancelPassword("")
      setCancelError(false)
      
      const relatedSlots: Reservation[] = []
      const dayReservations = schedule[activeCategory]?.[dateKey] || {}
      Object.values(dayReservations).forEach((res) => {
        if (res.user_name === booking.user_name) {
          relatedSlots.push(res)
        }
      })
      relatedSlots.sort((a, b) => a.hour_idx - b.hour_idx)
      
      setSlotsToCancel(relatedSlots)
      setIsCancelModalOpen(true)
      return
    }
    
    if (isSlotSelected(dateKey, hourIdx)) {
      setSelectedSlots((prev) => prev.filter((s) => !(s.dateKey === dateKey && s.hourIdx === hourIdx)))
    } else {
      setSelectedSlots((prev) => [...prev, { dateKey, hourIdx, dateObj: dayDate }])
    }
  }

  const handleOpenBookingModal = () => {
    if (selectedSlots.length === 0) return
    setInputName("")
    setInputPassword("")
    setIsBookingModalOpen(true)
  }

  const handleConfirmReservation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputName.trim() || !inputPassword) return

    setSaving(true)
    const hash = await hashPassword(inputPassword)

    const temporaryRows: Reservation[] = selectedSlots.map(({ dateKey, hourIdx }) => ({
      id: `temp-${dateKey}-${hourIdx}-${Math.random()}`,
      user_name: inputName.trim(),
      password_hash: hash,
      date_key: dateKey,
      hour_idx: hourIdx,
      category_id: activeCategory,
    }))

    // ⚡ OPTIMISTIC UI FLASH
    applyRows(temporaryRows)
    setSelectedSlots([])
    setIsBookingModalOpen(false)

    const dbPayload = temporaryRows.map(({ id, ...rest }) => rest)

    const { data, error } = await supabase
      .from("reservations")
      .insert(dbPayload)
      .select()

    setSaving(false)

    if (error) {
      console.error("❌ SUPABASE TRANSACTION FAILED", error)
      temporaryRows.forEach((row) => removeRow(row))
      alert(`Reservation Failed: ${error.message}`)
    } else if (data) {
      applyRows(data as Reservation[])
    }
  }

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cancelTarget || slotsToCancel.length === 0) return

    const targetBooking = schedule[activeCategory]?.[cancelTarget.dateKey]?.[cancelTarget.hourIdx]
    if (!targetBooking) return

    const hash = await hashPassword(cancelPassword)
    if (hash !== targetBooking.password_hash) {
      setCancelError(true)
      return
    }

    setCancelling(true)
    const idsToDelete = slotsToCancel.map(slot => slot.id)

    // ⚡ OPTIMISTIC UI FLASH
    slotsToCancel.forEach((slot) => {
      removeRow({ category_id: activeCategory, date_key: slot.date_key, hour_idx: slot.hour_idx })
    })
    
    setIsCancelModalOpen(false)
    setCancelTarget(null)

    const { error } = await supabase
      .from("reservations")
      .delete()
      .in("id", idsToDelete)

    setCancelling(false)

    if (error) {
      console.error("Error batch-cancelling requests", error)
      applyRows(slotsToCancel)
      alert("Error cancelling bookings from server. Restoring elements.")
    }
  }

  const toggleSlotCancelSelection = (res: Reservation) => {
    if (slotsToCancel.some(s => s.id === res.id)) {
      if (slotsToCancel.length === 1) return 
      setSlotsToCancel(prev => prev.filter(s => s.id !== res.id))
    } else {
      setSlotsToCancel(prev => [...prev, res].sort((a, b) => a.hour_idx - b.hour_idx))
    }
  }

  const handleClearSelection = () => setSelectedSlots([])

  const cat = CATEGORIES.find((c) => c.id === activeCategory)!
  const firstDay = daysOfWeek[0]
  const lastDay = daysOfWeek[6]
  const rangeDisplay = `${firstDay.dateLabel} – ${lastDay.dateLabel}`

  return (
    <div className="w-full min-h-screen bg-slate-50 p-4 text-slate-800 font-sans text-xs">
      <div className="max-w-[1600px] mx-auto bg-white rounded-lg shadow-sm border border-slate-200 p-4">

        {/* Header */}
        <div className="flex flex-col items-center justify-center mb-5">
          <h1 className="text-xl font-bold text-slate-700 tracking-tight">
            Photochemistry Lab Scheduler
          </h1>
          <p className="text-[10px] text-slate-400 mt-0.5">Book instruments & reactors · syncs live for all users</p>
        </div>

        {/* Category tabs */}
        <div className="flex flex-wrap gap-2 justify-center mb-5">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => { setActiveCategory(c.id); setSelectedSlots([]) }}
              className={`flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-semibold transition-all shadow-sm ${
                activeCategory === c.id
                  ? `${c.color} text-white border-transparent shadow-md scale-105`
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${activeCategory === c.id ? "bg-white/70" : c.dotColor}`}></span>
              <span>{c.label}</span>
              {"sublabel" in c && (
                <span className={`text-[9px] font-normal ${activeCategory === c.id ? "text-white/70" : "text-slate-400"}`}>
                  ({c.sublabel})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Week nav */}
        <div className="flex items-center justify-center gap-4 mb-5">
          <button
            onClick={handlePrevPeriod}
            className="px-3 py-1.5 border rounded bg-white hover:bg-slate-100 font-semibold transition-all text-xs shadow-sm"
          >
            ← Prev Week
          </button>
          <p className={`font-bold text-xs px-4 py-1.5 rounded-full border ${cat.textColor} ${cat.borderColor} ${cat.bgLight}`}>
            {rangeDisplay}
          </p>
          <button
            onClick={handleNextPeriod}
            className="px-3 py-1.5 border rounded bg-white hover:bg-slate-100 font-semibold transition-all text-xs shadow-sm"
          >
            Next Week →
          </button>
        </div>

        {/* Legend */}
        <div className="flex gap-4 justify-center mb-4 pb-3 text-[10px] font-medium text-slate-500 border-b border-slate-100">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-white border border-slate-300 rounded"></span> Available
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded opacity-60 ${cat.color}`}></span> Selected
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded ${cat.color}`}></span> Reserved
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-slate-100 border border-slate-200 rounded relative overflow-hidden">
              <span className="absolute inset-0 bg-[linear-gradient(45deg,transparent_45%,#cbd5e1_45%,#cbd5e1_55%,transparent_55%)] bg-[length:5px_5px]"></span>
            </span> Past
          </div>
        </div>

        {/* Loading state */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            Loading schedule…
          </div>
        ) : (
          <div className="w-full overflow-x-auto border border-slate-200 rounded shadow-sm">
            <table className="w-full min-w-[2000px] border-collapse table-fixed bg-white">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="w-[160px] p-3 border-r border-slate-200 sticky left-0 bg-slate-50 z-10 text-left font-bold text-slate-600">
                    Day / Date
                  </th>
                  {HOURS.map((hour, idx) => (
                    <th key={idx} className="p-2 border-r border-slate-200 text-center font-semibold text-[10px] text-slate-400">
                      {hour}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {daysOfWeek.map((day) => (
                  <tr
                    key={day.dbKey}
                    className={`border-b border-slate-200 hover:bg-slate-50/50 transition-colors h-14 ${day.isToday ? "bg-amber-50/20" : ""}`}
                  >
                    <td className={`p-3 border-r border-slate-200 font-bold sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] ${day.isToday ? "bg-amber-50 border-r-amber-200" : "bg-slate-50"}`}>
                      <div className="text-slate-900 font-bold flex items-center gap-1.5">
                        {day.name}
                        {day.isToday && <span className="text-[9px] bg-amber-500 text-white font-medium px-1 rounded">Today</span>}
                      </div>
                      <div className="text-[10px] text-slate-400 font-normal mt-0.5">{day.dateLabel}</div>
                    </td>

                    {HOURS.map((_, hourIdx) => {
                      const booking = schedule[activeCategory]?.[day.dbKey]?.[hourIdx]
                      const isReserved = !!booking
                      const isPast = isSlotPast(day.rawDate, hourIdx)
                      const isSelected = isSlotSelected(day.dbKey, hourIdx)

                      let cellStyle = `bg-white ${cat.colorHover} cursor-pointer`
                      if (isPast) {
                        cellStyle = "bg-slate-50 text-slate-300 cursor-not-allowed bg-[linear-gradient(45deg,transparent_48%,#e2e8f0_48%,#e2e8f0_52%,transparent_52%)] bg-[length:6px_6px]"
                      } else if (isReserved) {
                        cellStyle = `${cat.colorReserved} text-white font-semibold shadow-inner cursor-pointer`
                      } else if (isSelected) {
                        cellStyle = `${cat.colorSelected} text-white font-semibold cursor-pointer`
                      }

                      return (
                        <td
                          key={hourIdx}
                          onClick={() => handleCellClick(day.dbKey, hourIdx, day.rawDate)}
                          className={`border-r border-slate-200 p-1 text-center select-none align-middle transition-all text-[11px] truncate max-w-[90px] ${cellStyle}`}
                          title={isReserved ? `${booking.user_name} — click to manage cancel option` : isSelected ? "Click to deselect" : ""}
                        >
                          {isReserved ? booking.user_name : isSelected ? "✓" : ""}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Floating action bar */}
      {selectedSlots.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl border border-slate-700 text-xs font-medium">
          <span className={`${cat.color} text-white text-[10px] font-bold px-2 py-0.5 rounded-full`}>
            {selectedSlots.length}
          </span>
          <span>slot{selectedSlots.length > 1 ? "s" : ""} · <span className="font-bold">{cat.label}</span></span>
          <button
            onClick={handleOpenBookingModal}
            className={`${cat.color} hover:opacity-90 text-white font-semibold px-4 py-1.5 rounded-lg transition-all`}
          >
            Reserve →
          </button>
          <button onClick={handleClearSelection} className="text-slate-400 hover:text-white transition-colors ml-1" title="Clear">✕</button>
        </div>
      )}

      {/* ── Booking modal (Confirm password removed) ── */}
      <Dialog open={isBookingModalOpen} onOpenChange={setIsBookingModalOpen}>
        <DialogContent className="sm:max-w-[420px] bg-white text-slate-900 p-6 rounded-xl shadow-lg">
          <form onSubmit={handleConfirmReservation}>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">New Reservation</DialogTitle>
              <DialogDescription className="text-slate-500 text-xs mt-1">
                <span className={`font-bold ${cat.textColor}`}>{cat.label}</span>
                {" · "}
                <span className="font-semibold">{selectedSlots.length} slot{selectedSlots.length > 1 ? "s" : ""}</span>
                {" · "}Please review your order and set a password for future cancellations.
              </DialogDescription>
            </DialogHeader>

            {/* Slot summary */}
            <div className="my-3 max-h-28 overflow-y-auto rounded-lg bg-slate-50 border border-slate-200 p-2 flex flex-col gap-1">
              {selectedSlots
                .slice()
                .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.hourIdx - b.hourIdx)
                .map((s) => (
                  <div key={`${s.dateKey}-${s.hourIdx}`} className="text-[10px] text-slate-600 flex justify-between">
                    <span>{format(s.dateObj, "EEE, MMM d")}</span>
                    <span className="font-semibold">{HOURS[s.hourIdx]}</span>
                  </div>
                ))}
            </div>

            <div className="flex flex-col gap-3 my-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-600">Name</label>
                <input type="text" autoFocus required value={inputName}
                  onChange={(e) => setInputName(e.target.value)}
                  placeholder="e.g. Jane Smith"
                  className="w-full px-3 py-2 border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 bg-slate-50" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-600">Set your Password</label>
                <input type="password" required value={inputPassword}
                  onChange={(e) => setInputPassword(e.target.value)}
                  placeholder="password for future cancellations"
                  className="w-full px-3 py-2 border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 bg-slate-50" />
              </div>
            </div>

            <DialogFooter className="flex gap-2 justify-end border-t pt-4">
              <Button type="button" variant="outline" onClick={() => setIsBookingModalOpen(false)} className="text-xs px-4 py-2">Cancel</Button>
              <Button type="submit" disabled={saving}
                className="bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs px-4 py-2 rounded-lg shadow-sm disabled:opacity-60">
                {saving ? "Saving…" : `Confirm ${selectedSlots.length} Reservation${selectedSlots.length > 1 ? "s" : ""}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Cancel modal ── */}
      <Dialog open={isCancelModalOpen} onOpenChange={setIsCancelModalOpen}>
        <DialogContent className="sm:max-w-[400px] bg-white text-slate-900 p-6 rounded-xl shadow-lg">
          <form onSubmit={handleConfirmCancel}>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">Cancel Reservations</DialogTitle>
              <DialogDescription className="text-slate-500 text-xs mt-1">
                {cancelTarget && (() => {
                  const b = schedule[activeCategory]?.[cancelTarget.dateKey]?.[cancelTarget.hourIdx]
                  return b ? <>Found details for <span className="font-semibold text-slate-700">{b.user_name}</span> on this day. Select the slots you wish to cancel:</> : null
                })()}
              </DialogDescription>
            </DialogHeader>

            {/* Checklist of slots available for cancellation */}
            <div className="my-3 max-h-36 overflow-y-auto rounded-lg bg-slate-50 border border-slate-200 p-3 flex flex-col gap-2">
              {slotsToCancel.map((slot) => {
                const isPrimaryTarget = cancelTarget?.dateKey === slot.date_key && cancelTarget?.hourIdx === slot.hour_idx
                const isChecked = slotsToCancel.some(s => s.id === slot.id)
                
                return (
                  <label 
                    key={slot.id} 
                    className={`flex items-center justify-between p-1.5 rounded transition-colors text-xs cursor-pointer ${
                      isPrimaryTarget ? "bg-amber-50 font-medium border border-dashed border-amber-300" : "hover:bg-slate-100"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input 
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSlotCancelSelection(slot)}
                        className="rounded border-slate-300 text-red-500 focus:ring-red-400 accent-red-500"
                      />
                      <span className="text-slate-700">{HOURS[slot.hour_idx]}</span>
                    </div>
                    <span className="text-[10px] text-slate-400">{slot.date_key}</span>
                  </label>
                )
              })}
            </div>

            <div className="my-4 flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-600">Password</label>
              <input type="password" autoFocus required value={cancelPassword}
                onChange={(e) => { setCancelPassword(e.target.value); setCancelError(false) }}
                placeholder="Enter cancellation password"
                className={`w-full px-3 py-2 border rounded-lg text-xs focus:outline-none focus:ring-2 bg-slate-50 ${cancelError ? "border-red-400 focus:ring-red-400" : "focus:ring-red-500"}`} />
              {cancelError && <p className="text-[10px] text-red-500 font-medium">Incorrect password. Try again.</p>}
            </div>

            <DialogFooter className="flex gap-2 justify-end border-t pt-4">
              <Button type="button" variant="outline" onClick={() => setIsCancelModalOpen(false)} className="text-xs px-4 py-2">Go Back</Button>
              <Button type="submit" disabled={cancelling || slotsToCancel.length === 0}
                className="bg-red-500 hover:bg-red-600 text-white font-semibold text-xs px-4 py-2 rounded-lg shadow-sm disabled:opacity-60">
                {cancelling ? "Cancelling…" : `Cancel ${slotsToCancel.length} Selected`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}