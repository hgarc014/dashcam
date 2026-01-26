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

    function isAutopilotEngaged(state) {
        if (!state) return false;
        const s = String(state).trim().toUpperCase();
        if (!s) return false;
        return s === "1";
    }

    function createCanvas(width, height) {
        if (typeof OffscreenCanvas !== "undefined") {
            return new OffscreenCanvas(width, height);
        }
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        return c;
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
            autopilotState: pickString(raw, ["autopilotState"], "OFF"),
            gear: gearMapping[pickString(raw?.fields?.gearState, ["displayValue"])] || "—",
            timestamp: raw?.timestamp || null
        };
    }

    class CanvasHud {
        constructor(opts = {}) {
            this.opts = {...DEFAULTS, ...opts};
            this.blinkState = false;
            this.lastBlink = 0;

            this.staticLayerCanvas = null;
            this.staticLayerCtx = null;
        }

        render(ctx, telemetry, x, y, scale = 1) {
            if (!telemetry) return;

            const t = normalizeTelemetry(telemetry, this.opts);

            ctx.save();
            ctx.translate(x, y);
            ctx.scale(scale, scale);

            const base = this.getStaticLayer();
            if (base) ctx.drawImage(base, 0, 0);
            this.drawDynamic(ctx, t);

            ctx.restore();
        }

        getSize(scale = 1) {
            return {
                width: 420 * scale,
                height: 240 * scale
            };
        }

        drawCard(ctx, t) {
            const now = Date.now();
            if (now - this.lastBlink > 550) {
                this.blinkState = !this.blinkState;
                this.lastBlink = now;
            }

            // Tesla-style larger card
            const cardWidth = 420;
            const cardHeight = 240;

            // Draw shadow
            ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
            ctx.shadowBlur = 20;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 4;

            ctx.fillStyle = "rgba(15, 15, 18, 0.85)";
            this.roundRect(ctx, 0, 0, cardWidth, cardHeight, 20);
            ctx.fill();

            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
            ctx.lineWidth = 1.5;
            this.roundRect(ctx, 0, 0, cardWidth, cardHeight, 20);
            ctx.stroke();

            const cx = cardWidth / 2;

            // --- timestamp at top ---
            if (t.timestamp) {
                ctx.font = "500 16px -apple-system, system-ui, sans-serif";
                ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillText(t.timestamp, cx, 25);
            }

            // --- top row layout ---
            const topRowY = 90;

            // Left: Gear circle
            this.drawGearCircle(ctx, 55, topRowY, t.gear);

            // Left turn signal pill
            this.drawSignalPill(ctx, 130, topRowY, "◀", t.left && this.blinkState);

            // Center: Speed
            this.drawSpeed(ctx, cx, topRowY, t.speed, this.opts.useMph ? "mph" : "km/h");

            // Right turn signal pill
            this.drawSignalPill(ctx, cardWidth - 130, topRowY, "▶", t.right && this.blinkState);

            // Steering wheel circle (far right)
            this.drawWheelCircle(ctx, cardWidth - 55, topRowY, t.steerDeg);

            // --- Bottom container with darker inset ---
            const bottomY = 150;
            const bottomHeight = 70;
            const bottomPadding = 25;

            ctx.fillStyle = "rgba(8, 8, 12, 0.6)";
            this.roundRect(ctx, bottomPadding, bottomY, cardWidth - bottomPadding * 2, bottomHeight, 16);
            ctx.fill();

            ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
            ctx.lineWidth = 1;
            this.roundRect(ctx, bottomPadding, bottomY, cardWidth - bottomPadding * 2, bottomHeight, 16);
            ctx.stroke();

            // --- Self-Driving label inside container ---
            const labelY = bottomY + 28;
            if (isAutopilotEngaged(t.autopilotState)) {
                ctx.font = "600 30px -apple-system, system-ui, sans-serif";
                ctx.fillStyle = "rgb(85, 160, 255)";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("Self-Driving", cx, labelY);
            } else {
                ctx.font = "600 30px -apple-system, system-ui, sans-serif";
                ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("Human", cx, labelY);
            }

            // Bottom row icons in the darker container
            const bottomIconY = bottomY + bottomHeight / 2 + 8;

            // Brake on left
            this.drawBrakeCircle(ctx, 90, bottomIconY, t.brake);

            // Throttle on right
            this.drawThrottleCircle(ctx, cardWidth - 90, bottomIconY, t.throttlePct);
        }

        getStaticLayer() {
            if (this.staticLayerCanvas) return this.staticLayerCanvas;

            const cardWidth = 420;
            const cardHeight = 240;

            const c = createCanvas(cardWidth, cardHeight);
            const cctx = c.getContext("2d");
            if (!cctx) return null;

            this.staticLayerCanvas = c;
            this.staticLayerCtx = cctx;

            cctx.clearRect(0, 0, cardWidth, cardHeight);

            cctx.shadowColor = "rgba(0, 0, 0, 0.4)";
            cctx.shadowBlur = 20;
            cctx.shadowOffsetX = 0;
            cctx.shadowOffsetY = 4;

            cctx.fillStyle = "rgba(15, 15, 18, 0.85)";
            this.roundRect(cctx, 0, 0, cardWidth, cardHeight, 20);
            cctx.fill();

            cctx.shadowColor = "transparent";
            cctx.shadowBlur = 0;
            cctx.shadowOffsetX = 0;
            cctx.shadowOffsetY = 0;

            cctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
            cctx.lineWidth = 1.5;
            this.roundRect(cctx, 0, 0, cardWidth, cardHeight, 20);
            cctx.stroke();

            const bottomY = 150;
            const bottomHeight = 70;
            const bottomPadding = 25;

            cctx.fillStyle = "rgba(8, 8, 12, 0.6)";
            this.roundRect(cctx, bottomPadding, bottomY, cardWidth - bottomPadding * 2, bottomHeight, 16);
            cctx.fill();

            cctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
            cctx.lineWidth = 1;
            this.roundRect(cctx, bottomPadding, bottomY, cardWidth - bottomPadding * 2, bottomHeight, 16);
            cctx.stroke();

            return this.staticLayerCanvas;
        }

        drawDynamic(ctx, t) {
            const now = Date.now();
            if (now - this.lastBlink > 550) {
                this.blinkState = !this.blinkState;
                this.lastBlink = now;
            }

            const cardWidth = 420;
            const cardHeight = 240;
            const cx = cardWidth / 2;

            if (t.timestamp) {
                ctx.font = "500 16px -apple-system, system-ui, sans-serif";
                ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillText(t.timestamp, cx, 25);
            }

            const topRowY = 90;

            this.drawGearCircle(ctx, 55, topRowY, t.gear);
            this.drawSignalPill(ctx, 130, topRowY, "◀", t.left && this.blinkState);
            this.drawSpeed(ctx, cx, topRowY, t.speed, this.opts.useMph ? "mph" : "km/h");
            this.drawSignalPill(ctx, cardWidth - 130, topRowY, "▶", t.right && this.blinkState);
            this.drawWheelCircle(ctx, cardWidth - 55, topRowY, t.steerDeg);

            const bottomY = 150;
            const bottomHeight = 70;
            const labelY = bottomY + 28;

            if (isAutopilotEngaged(t.autopilotState)) {
                ctx.font = "600 30px -apple-system, system-ui, sans-serif";
                ctx.fillStyle = "rgb(85, 160, 255)";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("Self-Driving", cx, labelY);
            } else {
                ctx.font = "600 30px -apple-system, system-ui, sans-serif";
                ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("Human", cx, labelY);
            }

            const bottomIconY = bottomY + bottomHeight / 2 + 8;
            this.drawBrakeCircle(ctx, 90, bottomIconY, t.brake);
            this.drawThrottleCircle(ctx, cardWidth - 90, bottomIconY, t.throttlePct);
        }

// ---------- Tesla-ish primitives ----------

        drawGearCircle(ctx, x, y, gear) {
            const r = 28;
            ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
            ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.font = "700 18px -apple-system, system-ui, sans-serif";
            ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(gear || "—", x, y);
        }

        drawGearBlinkerPill(ctx, x, y, gear, active, isLeft) {
            const w = 130, h = 46, r = 23;
            const arrow = isLeft ? "◀" : "▶";

            ctx.fillStyle = active ? "rgba(255, 180, 0, 0.12)" : "rgba(255, 255, 255, 0.06)";
            ctx.strokeStyle = active ? "rgba(255, 180, 0, 0.35)" : "rgba(255, 255, 255, 0.12)";
            ctx.lineWidth = 1.5;
            this.roundRect(ctx, x - w / 2, y - h / 2, w, h, r);
            ctx.fill();
            ctx.stroke();

            // Gear on left side
            ctx.font = "700 20px -apple-system, system-ui, sans-serif";
            ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(gear || "—", x - 30, y);

            // Arrow on right side
            ctx.font = "18px -apple-system, system-ui, sans-serif";
            ctx.fillStyle = active ? "rgba(255, 200, 0, 1)" : "rgba(255, 255, 255, 0.3)";
            ctx.fillText(arrow, x + 30, y);
        }

        drawSignalPill(ctx, x, y, arrow, active) {
            const w = 68, h = 36, r = 18;

            ctx.fillStyle = active ? "rgba(255, 180, 0, 0.15)" : "rgba(255, 255, 255, 0.06)";
            ctx.strokeStyle = active ? "rgba(255, 180, 0, 0.4)" : "rgba(255, 255, 255, 0.12)";
            ctx.lineWidth = 1.5;
            this.roundRect(ctx, x - w / 2, y - h / 2, w, h, r);
            ctx.fill();
            ctx.stroke();

            ctx.font = "16px -apple-system, system-ui, sans-serif";
            ctx.fillStyle = active ? "rgba(255, 200, 0, 1)" : "rgba(255, 255, 255, 0.3)";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(arrow, x, y);
        }

        drawSpeed(ctx, x, y, speed, unit) {
            ctx.font = "700 64px -apple-system, system-ui, sans-serif";
            ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(Math.round(speed), x, y);

            ctx.font = "500 15px -apple-system, system-ui, sans-serif";
            ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(unit, x, y + 28);
        }

        drawWheelCircle(ctx, x, y, angleDeg) {
            const r = 32;
            const isActive = Math.abs(angleDeg) > 5;

            ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
            ctx.strokeStyle = isActive ? "rgba(100, 200, 255, 0.3)" : "rgba(255, 255, 255, 0.12)";
            ctx.lineWidth = isActive ? 2 : 1.5;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // simple steering wheel glyph (looks closer than the "T" lines)
            this.drawSteeringWheelGlyph(ctx, x, y, 20, angleDeg);
        }

        drawSteeringWheelGlyph(ctx, x, y, size, angleDeg) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate((angleDeg * Math.PI) / 180);

            ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
            ctx.lineWidth = 2.5;
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
            const r = 28;
            const fillColor = active ? "rgba(220, 50, 50, 0.2)" : "rgba(255, 255, 255, 0.06)";
            const strokeColor = active ? "rgba(220, 50, 50, 0.5)" : "rgba(255, 255, 255, 0.12)";

            ctx.fillStyle = fillColor;
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // pedal icon (like your screenshot)
            this.drawBrakePedalIcon(ctx, x, y, active);
        }

        drawThrottleCircle(ctx, x, y, pct) {
            const r = 28;
            ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
            ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Draw progress arc based on throttle percentage
            if (pct > 0) {
                const progressR = r - 3;
                const startAngle = -Math.PI / 2; // Start at top
                const endAngle = startAngle + (pct / 100) * Math.PI * 2;

                ctx.strokeStyle = "rgba(100, 220, 100, 0.8)";
                ctx.lineWidth = 4;
                ctx.lineCap = "round";
                ctx.beginPath();
                ctx.arc(x, y, progressR, startAngle, endAngle);
                ctx.stroke();
            }

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
            this.roundRect(ctx, -w / 2, -h / 2, w, h, r);
            ctx.fill();

            // grooves
            ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
            for (let i = -8; i <= 8; i += 4) {
                ctx.beginPath();
                ctx.moveTo(i, -h / 2 + 3);
                ctx.lineTo(i, h / 2 - 3);
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
            this.roundRect(ctx, -w / 2, -h / 2, w, h, r);
            ctx.fill();

            ctx.restore();
        }

        drawThrottlePill(ctx, x, y, pct) {
            // Center throttle indicator pill with left/right arrows
            const w = 220, h = 44, r = 22;

            ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
            ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
            ctx.lineWidth = 1.5;
            this.roundRect(ctx, x - w / 2, y - h / 2, w, h, r);
            ctx.fill();
            ctx.stroke();

            // Left arrow
            ctx.font = "20px -apple-system, system-ui, sans-serif";
            ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("◀", x - 70, y);

            // Center throttle value
            ctx.font = "600 20px -apple-system, system-ui, sans-serif";
            ctx.fillStyle = pct > 1 ? "rgba(120, 255, 120, 0.9)" : "rgba(255, 255, 255, 0.6)";
            ctx.fillText(Math.round(pct), x, y);

            // Right arrow
            ctx.font = "20px -apple-system, system-ui, sans-serif";
            ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
            ctx.fillText("▶", x + 70, y);
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
            ctx.font = "700 46px -apple-system, system-ui, sans-serif";
            ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const rounded = Math.round(speed);
            ctx.fillText(String(rounded), x, y - 4);

            ctx.font = "500 13px -apple-system, system-ui, sans-serif";
            ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
            ctx.fillText(unit, x, y + 24);
        }

        drawSignal(ctx, x, y, arrow, active) {
            const size = 32;
            const r = 10;

            ctx.fillStyle = active ? "rgba(120, 255, 120, 0.18)" : "rgba(10, 10, 12, 0.3)";
            ctx.strokeStyle = active ? "rgba(120, 255, 120, 0.45)" : "rgba(255, 255, 255, 0.15)";
            ctx.lineWidth = 1;

            this.roundRect(ctx, x - size / 2, y - 12, size, 24, r);
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
    }

    window.SeiCanvasHud = CanvasHud;
})();
