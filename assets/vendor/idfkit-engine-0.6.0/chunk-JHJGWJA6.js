// src/parsers/columns.ts
var INITIAL_CAPACITY = 64;
var GrowableArray = class {
  constructor(Ctor) {
    this.Ctor = Ctor;
    this.array = new Ctor(INITIAL_CAPACITY);
  }
  Ctor;
  array;
  length = 0;
  push(value) {
    if (this.length === this.array.length) {
      const grown = new this.Ctor(this.array.length * 2);
      grown.set(this.array);
      this.array = grown;
    }
    this.array[this.length++] = value;
  }
  finish() {
    return this.array.slice(0, this.length);
  }
};
var TimestampTableBuilder = class {
  month = new GrowableArray(Uint8Array);
  day = new GrowableArray(Uint8Array);
  hour = new GrowableArray(Uint8Array);
  minute = new GrowableArray(Uint8Array);
  dayOfSimulation = new GrowableArray(Uint32Array);
  environmentIndex = new GrowableArray(Uint32Array);
  get length() {
    return this.month.length;
  }
  /** Append a row and return its index. */
  push(timestamp) {
    this.month.push(timestamp.month);
    this.day.push(timestamp.day);
    this.hour.push(timestamp.hour);
    this.minute.push(timestamp.minute);
    this.dayOfSimulation.push(timestamp.dayOfSimulation);
    this.environmentIndex.push(timestamp.environmentIndex);
    return this.month.length - 1;
  }
  finish() {
    return {
      length: this.length,
      month: this.month.finish(),
      day: this.day.finish(),
      hour: this.hour.finish(),
      minute: this.minute.finish(),
      dayOfSimulation: this.dayOfSimulation.finish(),
      environmentIndex: this.environmentIndex.finish()
    };
  }
};
var SeriesBuilder = class {
  values = new GrowableArray(Float64Array);
  timeIndex = new GrowableArray(Uint32Array);
  get length() {
    return this.values.length;
  }
  push(value, row) {
    this.values.push(value);
    this.timeIndex.push(row);
  }
  finish() {
    return { values: this.values.finish(), timeIndex: this.timeIndex.finish() };
  }
};
function timestampAt(series, i) {
  const row = series.timeIndex[i];
  if (row === void 0) {
    throw new RangeError(`No value ${String(i)} in a series of ${String(series.values.length)}`);
  }
  const t = series.timestamps;
  return {
    month: t.month[row] ?? 0,
    day: t.day[row] ?? 0,
    hour: t.hour[row] ?? 0,
    minute: t.minute[row] ?? 0,
    dayOfSimulation: t.dayOfSimulation[row] ?? 0,
    environmentIndex: t.environmentIndex[row] ?? 0
  };
}
function toDataPoints(series) {
  const points = new Array(series.values.length);
  for (let i = 0; i < series.values.length; i++) {
    points[i] = { timestamp: timestampAt(series, i), value: series.values[i] ?? 0 };
  }
  return points;
}

export {
  TimestampTableBuilder,
  SeriesBuilder,
  timestampAt,
  toDataPoints
};
//# sourceMappingURL=chunk-JHJGWJA6.js.map