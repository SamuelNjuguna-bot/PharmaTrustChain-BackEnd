import express, { Request, Response } from "express";
import { Sequelize, DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";
import path from "path";

// ✅ Initialize SQLite connection (same path as your main DB)
const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: path.join(__dirname, "../pharmadb.sqlite"),
  logging: false,
});

// ✅ Define PPBRecord model (must match main server)
class PPBRecord extends Model<InferAttributes<PPBRecord>, InferCreationAttributes<PPBRecord>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare email: string;
  declare licenseNumber: string;
  declare role: number;
}

PPBRecord.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    licenseNumber: { type: DataTypes.STRING, allowNull: false, unique: true },
    role: { type: DataTypes.INTEGER, allowNull: false },
  },
  { sequelize, modelName: "PPBRecord", timestamps: false }
);

// ✅ Express app
const app = express();

// ✅ Route to view seeded PPB data
app.get("/seeded", async (_req: Request, res: Response) => {
  try {
    const records = await PPBRecord.findAll();
    res.json({ success: true, total: records.length, data: records });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch seeded data", details: error.message });
  }
});

// ✅ Start viewer server
(async () => {
  await sequelize.sync(); // ensures models are initialized
  app.listen(5050, () => {
    console.log("✅ Seed viewer running on http://localhost:5050/seeded");
  });
})();
