"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const sequelize_1 = require("sequelize");
const path_1 = __importDefault(require("path"));
// ✅ Initialize SQLite connection (same path as your main DB)
const sequelize = new sequelize_1.Sequelize({
    dialect: "sqlite",
    storage: path_1.default.join(__dirname, "../pharmadb.sqlite"),
    logging: false,
});
// ✅ Define PPBRecord model (must match main server)
class PPBRecord extends sequelize_1.Model {
}
PPBRecord.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    email: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    licenseNumber: { type: sequelize_1.DataTypes.STRING, allowNull: false, unique: true },
    role: { type: sequelize_1.DataTypes.INTEGER, allowNull: false },
}, { sequelize, modelName: "PPBRecord", timestamps: false });
// ✅ Express app
const app = (0, express_1.default)();
// ✅ Route to view seeded PPB data
app.get("/seeded", async (_req, res) => {
    try {
        const records = await PPBRecord.findAll();
        res.json({ success: true, total: records.length, data: records });
    }
    catch (error) {
        res
            .status(500)
            .json({ error: "Failed to fetch seeded data", details: error.message });
    }
});
// ✅ Start viewer server
(async () => {
    await sequelize.sync(); // ensures models are initialized
    app.listen(5050, () => {
        console.log("✅ Seed viewer running on http://localhost:5050/seeded");
    });
})();
