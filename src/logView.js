'use strict';

/**
 * Scrollable log pane.
 *
 * Wraps a blessed-contrib `log` widget (which is a blessed `List`) and adds:
 *  - batched writes (dev servers can emit hundreds of lines per second and
 *    rebuilding the widget on every single line is far too slow),
 *  - follow-the-tail behaviour,
 *  - scroll back / pause with a "N new lines" indicator,
 *  - a bounded history so long running servers cannot eat all memory.
 *
 * Scrolling is implemented by trimming the tail of the visible slice rather
 * than by touching blessed's internal childBase/childOffset, so it behaves
 * identically on every blessed version. The widget is only ever asked to
 * `setItems()` and `setLabel()`.
 */

const DEFAULT_MAX_LINES = 500;

class LogView {
  /**
   * @param {object} widget  blessed-contrib log widget
   * @param {object} [options]
   * @param {number} [options.maxLines]      history size
   * @param {number} [options.flushInterval] ms between repaints
   * @param {function} [options.viewportHeight] visible row count (used to clamp scrolling)
   * @param {function} [options.onChange]    called after the widget changed
   * @param {string}   [options.label]       base label
   */
  constructor(widget, options = {}) {
    this.widget = widget;
    this.maxLines = options.maxLines || DEFAULT_MAX_LINES;
    this.flushInterval = options.flushInterval || 100;
    this.viewportHeight = options.viewportHeight || (() => (typeof widget.height === 'number' ? widget.height - 2 : 10));
    this.onChange = options.onChange || (() => {});
    this.baseLabel = options.label || ' logs ';

    this.lines = [];
    this.follow = true;
    this.viewOffset = 0;
    // While paused the visible history is frozen at this length, so incoming
    // lines cannot shift what the user is reading underneath them.
    this.frozenLength = null;
    this.pendingNew = 0;
    this.dirty = true;
    this.lastLabel = null;

    this.timer = setInterval(() => this.flush(), this.flushInterval);
    if (this.timer.unref) this.timer.unref();

    this.flush();
  }

  get paused() {
    return !this.follow;
  }

  /** Append one already formatted (tagged) line. */
  push(line) {
    this.lines.push(String(line));
    if (this.lines.length > this.maxLines) {
      this.lines.splice(0, this.lines.length - this.maxLines);
      if (this.viewOffset > 0) this.viewOffset = Math.min(this.viewOffset, this.lines.length);
    }
    if (!this.follow) this.pendingNew += 1;
    this.dirty = true;
  }

  /** Append many lines at once. */
  pushAll(lines) {
    lines.forEach((line) => this.push(line));
  }

  /** Replace the whole history. */
  clear() {
    this.lines = [];
    this.viewOffset = 0;
    this.pendingNew = 0;
    this.follow = true;
    this.frozenLength = null;
    this.dirty = true;
    this.flush();
  }

  /** Repaint if anything changed. Safe to call on a timer. */
  flush() {
    if (!this.dirty) return;
    this.dirty = false;

    if (this.follow) {
      this.viewOffset = 0;
      this.frozenLength = null;
      this.pendingNew = 0;
      this.render();
    }
    this.updateLabel();
    this.onChange();
  }

  /** Number of lines that are part of the current (possibly frozen) view. */
  visibleLength() {
    if (this.follow) return this.lines.length;
    const frozen = this.frozenLength == null ? this.lines.length : this.frozenLength;
    return Math.min(frozen, this.lines.length);
  }

  render() {
    const end = this.visibleLength();
    const visible = this.viewOffset > 0 ? this.lines.slice(0, Math.max(0, end - this.viewOffset)) : this.lines.slice(0, end);
    this.widget.setItems(visible);
  }

  clampOffset(offset) {
    const viewport = Math.max(1, Number(this.viewportHeight()) || 1);
    const maxOffset = Math.max(0, this.visibleLength() - viewport);
    return Math.max(0, Math.min(maxOffset, offset));
  }

  /** Scroll back `amount` lines (pauses following). */
  scrollUp(amount = 3) {
    if (!this.lines.length) return;
    if (this.follow) this.frozenLength = this.lines.length;
    this.follow = false;
    this.viewOffset = this.clampOffset(this.viewOffset + amount);
    this.repaintNow();
  }

  /** Scroll towards the tail; reaches the tail -> resume following. */
  scrollDown(amount = 3) {
    if (this.follow) return;
    this.viewOffset = Math.max(0, this.viewOffset - amount);
    if (this.viewOffset === 0) {
      this.follow = true;
      this.frozenLength = null;
      this.pendingNew = 0;
    }
    this.repaintNow();
  }

  /** Jump to the very top of the history (pauses following). */
  scrollTop() {
    if (!this.lines.length) return;
    if (this.follow) this.frozenLength = this.lines.length;
    this.follow = false;
    this.viewOffset = this.clampOffset(this.visibleLength());
    this.repaintNow();
  }

  /** Resume following the tail. */
  followTail() {
    this.follow = true;
    this.frozenLength = null;
    this.viewOffset = 0;
    this.pendingNew = 0;
    this.repaintNow();
  }

  /** Page up/down by roughly one screen. */
  page(direction) {
    const viewport = Math.max(1, Number(this.viewportHeight()) || 1);
    if (direction < 0) this.scrollUp(viewport - 1);
    else this.scrollDown(viewport - 1);
  }

  repaintNow() {
    this.render();
    this.updateLabel();
    this.onChange();
  }

  label() {
    if (this.paused) {
      const newLines = this.pendingNew > 0 ? `, ${this.pendingNew} new` : '';
      return `${this.baseLabel}paused${newLines} \u2014 G to follow`;
    }
    return this.baseLabel;
  }

  updateLabel() {
    if (!this.widget.setLabel) return;
    const label = this.label();
    if (label !== this.lastLabel) {
      this.lastLabel = label;
      this.widget.setLabel(label);
    }
  }

  destroy() {
    clearInterval(this.timer);
  }
}

module.exports = { LogView, DEFAULT_MAX_LINES };
