/**
 * sei_canvas_hud.js
 *
 * Canvas-based HUD overlay for Tesla Dashcam SEI Explorer.
 * Renders directly to canvas for video export compatibility.
 */

(function () {
  const DEFAULTS = {
    useMph: true,
    maxThrottlePct: 100,
    maxSteerDeg: 540
  };

  const clamp = (n, min, max) =>
    typeof n !== "number" || Number.isNaN(n) ? min : Math.max(min, Math.min(max, n));

  function pickNumber(obj, keys, fallback = null) {
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === "number" && !Number.isNaN(v)) return v;
      if (typeof v === "string" && !Number.isNaN(Number(v))) return Number(v);
    }
    return fallback;
  }

  function pickBool(obj, keys, fallback = false) {
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v !== 0;
      if (typeof v === "string") {
        const s = v.toLowerCase();
        if (["true", "1", "yes"].includes(s)) return true;
        if (["false", "0", "no"].includes(s)) return false;
      }
    }
    return fallback;
  }

  function pickString(obj, keys, fallback = "") {
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === "string" && v.trim()) return v;
      if (typeof v === "number") return String(v);
    }
    return fallback;
  }

  function normalizeTelemetry(raw, opts) {
    const speedMps = pickNumber(raw, ["vehicleSpeedMps"], 0);
    const speedMph = speedMps * 2.23694;

    let throttleRaw = pickNumber(raw, ["acceleratorPedalPosition"], 0);
    if (throttleRaw <= 1.2) throttleRaw *= 100;

    const gearMapping = {
      GEAR_DRIVE: "D",
      GEAR_NEUTRAL: "N",
      GEAR_PARK: "P",
      GEAR_REVERSE: "R"
    };

    return {
      speed: opts.useMph ? speedMph : speedMph * 1.609,
      steerDeg: pickNumber(raw, ["steeringWheelAngle"], 0),
      left: pickBool(raw, ["blinkerOnLeft"]),
      right: pickBool(raw, ["blinkerOnRight"]),
      brake: pickBool(raw, ["brakeApplied"]),
      throttlePct: clamp(throttleRaw, 0, 100),
      autopilotState: pickString(raw, ["autopilotState"]),
      gear: gearMapping[pickString(raw?.fields?.gearState, ["displayValue"])] || "—"
    };
  }

  class CanvasHud {
    constructor(opts = {}) {
      this.opts = { ...DEFAULTS, ...opts };
      this.blinkState = false;
      this.lastBlink = 0;
    }

    render(ctx, telemetry, x, y, scale = 1) {
      if (!telemetry) return;

      const t = normalizeTelemetry(telemetry, this.opts);
      
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);

      this.drawCard(ctx, t);

      ctx.restore();
    }

    getSize(scale = 1) {
      return {
        width: 420 * scale,
        height: 210 * scale
      };
    }

    drawCard(ctx, t) {
      const now = Date.now();
      if (now - this.lastBlink > 550) {
        this.blinkState = !this.blinkState;
        this.lastBlink = now;
      }

      // Tesla-style larger card (matches your image2 proportions much better)
      const cardWidth = 420;
      const cardHeight = 210;

      ctx.fillStyle = "rgba(10, 10, 12, 0.38)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
      ctx.lineWidth = 1;
      this.roundRect(ctx, 0, 0, cardWidth, cardHeight, 26);
      ctx.fill();
      ctx.stroke();

      const cx = cardWidth / 2;

      // --- top row layout ---
      const topRowY = 70;

      // Gear circle (left)
      this.drawGearCircle(ctx, 55, topRowY - 25, t.gear);

      // Blinkers + speed center
      this.drawSignalPill(ctx, cx - 75, topRowY - 25, "◀", t.left && this.blinkState);
      this.drawSpeed(ctx, cx, topRowY - 25, t.speed, this.opts.useMph ? "mph" : "km/h");
      this.drawSignalPill(ctx, cx + 75, topRowY - 25, "▶", t.right && this.blinkState);

      // Steering wheel circle (top right)
      this.drawWheelCircle(ctx, cardWidth - 55, topRowY - 25, t.steerDeg);

      // --- bottom row icons ---
      this.drawBrakeCircle(ctx, 70, 150, t.brake);
      this.drawThrottleCircle(ctx, cardWidth - 70, 150, t.throttlePct);

      // --- label ---
      // In your screenshot it always shows when AP is active; tweak rule as you want
      if (t.autopilotState && t.autopilotState !== "OFF") {
        ctx.font = "700 28px system-ui";
        ctx.fillStyle = "rgb(90, 160, 255)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Self-Driving", cx, 175);
      }
    }

// ---------- Tesla-ish primitives ----------

    drawGearCircle(ctx, x, y, gear) {
      const r = 30;
      ctx.fillStyle = "rgba(10, 10, 12, 0.40)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.font = "800 20px system-ui";
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(gear || "—", x, y);
    }

    drawSignalPill(ctx, x, y, arrow, active) {
      const w = 70, h = 40, r = 18;

      ctx.fillStyle = "rgba(10, 10, 12, 0.35)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
      ctx.lineWidth = 1;
      this.roundRect(ctx, x - w/2, y - h/2, w, h, r);
      ctx.fill();
      ctx.stroke();

      ctx.font = "18px system-ui";
      ctx.fillStyle = active ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 0.35)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(arrow, x, y);
    }

    drawWheelCircle(ctx, x, y, angleDeg) {
      const r = 30;
      ctx.fillStyle = "rgba(10, 10, 12, 0.40)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // simple steering wheel glyph (looks closer than the "T" lines)
      this.drawSteeringWheelGlyph(ctx, x, y, 18, angleDeg);
    }

    drawSteeringWheelGlyph(ctx, x, y, size, angleDeg) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((angleDeg * Math.PI) / 180);

      ctx.strokeStyle = "rgba(255, 255, 255, 0.90)";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";

      // outer wheel
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      ctx.stroke();

      // spokes
      ctx.beginPath();
      ctx.moveTo(-size * 0.6, 0);
      ctx.lineTo(size * 0.6, 0);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, size * 0.75);
      ctx.stroke();

      // hub
      ctx.fillStyle = "rgba(255, 255, 255, 0.90)";
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    drawBrakeCircle(ctx, x, y, active) {
      const r = 30;
      ctx.fillStyle = "rgba(10, 10, 12, 0.40)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // pedal icon (like your screenshot)
      this.drawBrakePedalIcon(ctx, x, y, active);
    }

    drawThrottleCircle(ctx, x, y, pct) {
      const r = 30;
      ctx.fillStyle = "rgba(10, 10, 12, 0.40)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      this.drawThrottlePedalIcon(ctx, x, y, pct);
    }

    drawBrakePedalIcon(ctx, x, y, active) {
      // stylized “brake” block with grooves
      ctx.save();
      ctx.translate(x, y);

      ctx.fillStyle = active ? "rgba(255, 90, 90, 0.85)" : "rgba(255, 255, 255, 0.65)";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.20)";
      ctx.lineWidth = 1;

      const w = 22, h = 16, r = 4;
      this.roundRect(ctx, -w/2, -h/2, w, h, r);
      ctx.fill();

      // grooves
      ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
      for (let i = -8; i <= 8; i += 4) {
        ctx.beginPath();
        ctx.moveTo(i, -h/2 + 3);
        ctx.lineTo(i, h/2 - 3);
        ctx.stroke();
      }

      ctx.restore();
    }

    drawThrottlePedalIcon(ctx, x, y, pct) {
      // stylized “throttle” vertical bar
      ctx.save();
      ctx.translate(x, y);

      const on = pct > 1;
      ctx.fillStyle = on ? "rgba(120, 255, 120, 0.85)" : "rgba(255, 255, 255, 0.65)";

      const w = 10, h = 28, r = 4;
      this.roundRect(ctx, -w/2, -h/2, w, h, r);
      ctx.fill();

      ctx.restore();
    }

    roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    drawSpeed(ctx, x, y, speed, unit) {
      ctx.font = "bold 28px system-ui";
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(Math.round(speed).toString(), x, y);

      ctx.font = "12px system-ui";
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      ctx.fillText(unit, x, y + 20);
    }

    drawSignal(ctx, x, y, arrow, active) {
      const size = 32;
      const r = 10;
      
      ctx.fillStyle = active ? "rgba(120, 255, 120, 0.18)" : "rgba(10, 10, 12, 0.3)";
      ctx.strokeStyle = active ? "rgba(120, 255, 120, 0.45)" : "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;
      
      this.roundRect(ctx, x - size/2, y - 12, size, 24, r);
      ctx.fill();
      ctx.stroke();

      ctx.font = "16px system-ui";
      ctx.fillStyle = active ? "rgba(120, 255, 120, 1)" : "rgba(255, 255, 255, 0.4)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(arrow, x, y);
    }

    drawWheel(ctx, x, y, angle) {
      const radius = 16;
      
      ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((angle * Math.PI) / 180);
      
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      
      ctx.beginPath();
      ctx.moveTo(-10, -3);
      ctx.lineTo(10, -3);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.moveTo(0, -3);
      ctx.lineTo(0, 10);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.fill();
      
      ctx.restore();
    }

    drawPedal(ctx, x, y, fillPct, color) {
      const radius = 16;
      
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.beginPath();
      ctx.arc(x, y, radius - 4, 0, Math.PI * 2);
      ctx.fill();

      if (fillPct > 0) {
        const fillHeight = ((radius - 4) * 2 * fillPct) / 100;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, radius - 4, 0, Math.PI * 2);
        ctx.clip();
        
        ctx.fillStyle = color;
        ctx.fillRect(x - (radius - 4), y + (radius - 4) - fillHeight, (radius - 4) * 2, fillHeight);
        
        ctx.restore();
      }
    }

    // drawThrottle(ctx, x, y, pct) {
    //   this.drawPedal(ctx, x, y, pct, "rgba(120, 255, 120, 0.7)");
    // }
    //
    // drawBrake(ctx, x, y, active) {
    //   this.drawPedal(ctx, x, y, active ? 100 : 0, "rgba(255, 90, 90, 0.75)");
    // }
    //
    // drawGear(ctx, x, y, gear) {
    //   const width = 40;
    //   const height = 24;
    //   const r = 12;
    //
    //   ctx.fillStyle = "rgba(10, 10, 12, 0.5)";
    //   ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    //   ctx.lineWidth = 1;
    //
    //   this.roundRect(ctx, x - width/2, y - height/2, width, height, r);
    //   ctx.fill();
    //   ctx.stroke();
    //
    //   ctx.font = "bold 12px system-ui";
    //   ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    //   ctx.textAlign = "center";
    //   ctx.textBaseline = "middle";
    //   ctx.fillText(gear, x, y);
    // }
    //
    // drawAutopilotLabel(ctx, x, y, state) {
    //   ctx.font = "600 13px system-ui";
    //   ctx.fillStyle = "rgb(90, 160, 255)";
    //   ctx.textAlign = "center";
    //   ctx.textBaseline = "middle";
    //   ctx.fillText(state, x, y);
    // }
  }

  window.SeiCanvasHud = CanvasHud;
})();
