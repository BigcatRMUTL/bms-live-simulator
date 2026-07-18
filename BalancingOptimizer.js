/**
 * ==============================================================================
 * MODULE: Intelligent BMS Balancing Topology Optimizer (AI-Logic Simulation)
 * Feature: Dynamic Mode Switching based on Delta-V, Current, and Power Loss
 * Developer: Jakkrit Jathongkham (Control & Automation Systems Engineering)
 * ==============================================================================
 */

export class BalancingOptimizer {
    constructor() {
        this.lastSwitchReason = "Initial Optimization Profile";
    }

    /**
     * คำนวณเลือกโหมดบาลานซ์ที่คุ้มค่าที่สุด (Optimize) ตามสภาวะฮาร์ดแวร์เรียลไทม์
     */
    selectOptimalTopology(deltaV_mV, packCurrent, totalLoss) {
        // เคสที่ 1: แรงดันต่างกันนิดเดียว (คลาดเคลื่อนต่ำมาก) 
        if (deltaV_mV <= 20) {
            this.lastSwitchReason = "Delta-V ต่ำ (< 20mV) ใช้ Passive Bypass เพื่อความแม่นยำสูงและประหยัดพื้นที่กระสวยประจุ";
            return 'passive';
        }

        // เคสที่ 2: เกิดสภาวะโหลดจ่ายกระแสหนัก (High Discharge Current)
        if (packCurrent < -8.0) {
            this.lastSwitchReason = "ตรวจพบกระแสโหลดสูง (> 8A) บังคับใช้ Inductive Buck-Boost เพื่อกักเก็บพลังงานผ่านขดลวดไม่ให้สูญเสียเป็นความร้อน";
            return 'inductive';
        }

        // เคสที่ 3: แรงดันคลาดเคลื่อนสูงมากวิกฤต (ต้องการความเร็วในการดึงกระแสลู่เข้าหากัน)
        if (deltaV_mV > 150) {
            this.lastSwitchReason = "🚨 แรงดันคลาดเคลื่อนสูงวิกฤต (> 150mV) เลือกใช้ Flyback Core ดึงกระแสจากก้อนสูงสุดลงก้อนต่ำสุดโดยตรง";
            return 'transformer';
        }

        // เคสที่ 4: สภาวะทั่วไป แรงดันต่างปานกลางและกระแสไม่สูงเกินไป
        this.lastSwitchReason = "สภาวะทั่วไป เลือกใช้ Active Switched-Capacitor เพื่อโยกย้ายพลังงานประสิทธิภาพสูงสุดข้ามเซลล์ข้างเคียง";
        return 'capacitor';
    }
}