# Time-grid drag preview (live landing indicator)

**Date:** 2026-07-22
**Branch:** `feat/calendar-base-view`
**Area:** `src/bases/calendar/layouts/timegrid.ts`, `styles.css`

## Problem

In the Week / 3 Days / Day calendar views (`TimeGridLayout`), dragging a timed
event gives no indication of where it will land. The original block dims to 40%
opacity (`.is-dragging`) and stays in place; the drop target is invisible until
the pointer is released. The Kanban view solves the equivalent problem by
physically reordering the card in the DOM during `dragover`, so the target
position is shown live. The time grid needs the same "previsualization".

Timed blocks are absolutely positioned (`top` / `height`), so DOM reordering is
not applicable. Instead we render a single **ghost preview block** that tracks
the pointer's snapped landing position.

## Behavior

- While a timed event is dragged over a day column, a ghost block appears at the
  snapped (15-minute) landing position.
- The ghost is sized to the dragged event's duration, clipped to the bottom of
  the column.
- The ghost shows the **landing start time** (snapped, e.g. `14:15`) and the
  event **title**, mirroring a real event block so the user reads the exact new
  time while dragging.
- The ghost follows the pointer and moves between day columns as the pointer
  crosses column boundaries (only one ghost exists at a time).
- The ghost is dashed, translucent, and does not capture pointer events.
- On drop, the ghost is removed and the existing `reschedule` path runs
  unchanged.
- On drag end (including drags released outside any column) or drag cancel, the
  ghost is removed.
- The original dragged block keeps its existing dimmed (`.is-dragging`) state.

## Scope boundaries

- **All-day row:** unchanged. It keeps its existing `.is-drop-target` column
  highlight, which already signals the target day. The ghost applies only to the
  timed grid body, where the exact vertical landing position is otherwise
  ambiguous.
- **Snapping:** the ghost snaps to the same 15-minute grid the drop uses
  (`pointerMinutes`), so the preview always equals the outcome.
- **Resize** interaction is untouched (it already mutates the block's height
  live via pointer events).
- No changes to the drag/drop data flow, callbacks, or `view.ts`. This is a
  purely presentational addition inside `TimeGridLayout`.

## Implementation

All changes are confined to `TimeGridLayout` in
`src/bases/calendar/layouts/timegrid.ts`, plus one CSS rule in `styles.css`.

### State

Add one field:

```ts
private preview: HTMLElement | null = null;
```

### Duration helper

The dragged event's duration in minutes, reused for the ghost height:

```ts
function durationMinutes(event: CalendarEvent): number {
    return (endTimeOf(event) - event.start.getTime()) / 60000;
}
```

`endTimeOf` already falls back to `DEFAULT_EVENT_MINUTES` when the event has no
end, so untimed-duration events get a sensible 60-minute ghost.

### Preview rendering

A method that creates-or-repositions the single ghost inside a given column:

```ts
private showPreview(
    col: HTMLElement,
    day: Date,
    minutes: number,
    event: CalendarEvent,
): void
```

- Ensures `this.preview` exists (create with class
  `obsilities-calendar-event is-preview`, containing a
  `.obsilities-calendar-event-time` span and a
  `.obsilities-calendar-event-title` span).
- If the ghost is not already a child of `col`, move it there.
- `top = (minutes / 60) * HOUR_HEIGHT`.
- `height = clamp(durationMinutes(event) / 60 * HOUR_HEIGHT,
  MIN_BLOCK_HEIGHT, COL_HEIGHT - top)`.
- Updates the time span text to `formatTime(addMinutes(startOfDay(day), minutes))`
  and the title span text to `event.title`.
- Spans the full column width (`left: 0; width: 100%`) — a preview does not need
  lane packing.

A matching teardown:

```ts
private clearPreview(): void {
    this.preview?.remove();
    this.preview = null;
}
```

### Wiring

- In `registerTimedDropZone`'s `dragover` handler (which already runs only when
  `this.draggedId` is set): resolve the dragged event via
  `ctx.events.find(ev => ev.id === this.draggedId)`, compute
  `this.pointerMinutes(col, e.clientY)`, and call
  `showPreview(col, day, minutes, event)` (`day` is already in
  `registerTimedDropZone`'s closure).
- In the same handler's `drop`: call `clearPreview()` before/around the existing
  reschedule.
- In `buildTimedBlock`, the draggable branch already passes an `onDragEnd`
  callback that sets `this.draggedId = null`. Extend it to also call
  `this.clearPreview()`. This covers drops outside any column and cancelled
  drags, because `attachChipInteractions` fires `onDragEnd` on the chip's
  `dragend` event unconditionally.

### CSS

Add to `styles.css` near the existing `.obsilities-calendar-event` rules:

```css
.obsilities-calendar-event.is-preview {
    pointer-events: none;
    border-style: dashed;
    opacity: 0.75;
    background: color-mix(
        in srgb,
        var(--obsilities-cal-accent) 14%,
        var(--background-primary)
    );
    z-index: 3;
}
```

`pointer-events: none` is essential: the ghost sits inside the drop-zone column,
and must not become the `dragover` hit-test target or it would suppress the
column's own `dragover`/`drop`.

## Testing

Manual verification in the plugin (per `build-and-reload`: `npm run build` then
reload the view), since there is no unit harness for DOM drag interactions:

1. Week view: drag a timed event — a dashed ghost appears at the pointer,
   snapping in 15-minute steps, showing the new time; dropping lands the event
   exactly where the ghost was.
2. Drag across day columns — the ghost hops to the column under the pointer.
3. Drag a multi-hour event near the bottom of a column — the ghost clips to the
   column bottom (never overflows).
4. Drop, then re-render — no orphan ghost remains.
5. Release the drag outside all columns — the ghost is removed (no leak).
6. 3 Days and Day views — same behavior.
7. All-day row drag — still shows only the column highlight, no ghost.

## Non-goals

- Live preview for all-day drags (keeps existing highlight).
- Changing snap granularity or drop semantics.
- Any change to Kanban, Month, Year, or Agenda layouts.
