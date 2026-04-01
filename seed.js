'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const MenuItem = require('./models/MenuItem');
const Table = require('./models/Table');
const User = require('./models/User');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const menuItems = [
  { name: 'Butter Chicken', description: 'Creamy tomato-based chicken curry', price: 280, category: 'Main Course', emoji: '🍛', isVeg: false, preparationTime: 20, tags: ['spicy', 'popular'], stats: { totalOrdered: 120, avgRating: 4.5, ratingCount: 40, totalRevenue: 33600 } },
  { name: 'Paneer Tikka', description: 'Grilled cottage cheese with spices', price: 220, category: 'Starters', emoji: '🧀', isVeg: true, preparationTime: 15, tags: ['vegetarian', 'grilled'], stats: { totalOrdered: 90, avgRating: 4.3, ratingCount: 30, totalRevenue: 19800 } },
  { name: 'Dal Makhani', description: 'Slow-cooked black lentils in butter and cream', price: 180, category: 'Main Course', emoji: '🫘', isVeg: true, preparationTime: 15, tags: ['vegetarian', 'comfort'], stats: { totalOrdered: 75, avgRating: 4.4, ratingCount: 25, totalRevenue: 13500 } },
  { name: 'Chicken Biryani', description: 'Fragrant basmati rice with spiced chicken', price: 320, category: 'Rice & Biryani', emoji: '🍚', isVeg: false, preparationTime: 25, tags: ['popular', 'filling'], stats: { totalOrdered: 200, avgRating: 4.7, ratingCount: 80, totalRevenue: 64000 } },
  { name: 'Masala Dosa', description: 'Crispy rice crepe with spiced potato filling', price: 120, category: 'South Indian', emoji: '🥞', isVeg: true, preparationTime: 12, tags: ['breakfast', 'crispy'], stats: { totalOrdered: 150, avgRating: 4.6, ratingCount: 60, totalRevenue: 18000 } },
  { name: 'Garlic Naan', description: 'Soft leavened bread with garlic butter', price: 60, category: 'Breads', emoji: '🫓', isVeg: true, preparationTime: 8, tags: ['bread', 'popular'], stats: { totalOrdered: 300, avgRating: 4.5, ratingCount: 100, totalRevenue: 18000 } },
  { name: 'Mango Lassi', description: 'Chilled yogurt drink with fresh mango', price: 80, category: 'Beverages', emoji: '🥭', isVeg: true, preparationTime: 5, tags: ['cold', 'sweet'], stats: { totalOrdered: 180, avgRating: 4.8, ratingCount: 70, totalRevenue: 14400 } },
  { name: 'Gulab Jamun', description: 'Soft milk dumplings in rose sugar syrup', price: 90, category: 'Desserts', emoji: '🍮', isVeg: true, preparationTime: 5, tags: ['sweet', 'dessert'], stats: { totalOrdered: 110, avgRating: 4.6, ratingCount: 45, totalRevenue: 9900 } },
  { name: 'Chicken 65', description: 'Spicy deep-fried chicken appetizer', price: 240, category: 'Starters', emoji: '🍗', isVeg: false, preparationTime: 15, tags: ['spicy', 'fried'], stats: { totalOrdered: 85, avgRating: 4.4, ratingCount: 35, totalRevenue: 20400 } },
  { name: 'Veg Fried Rice', description: 'Wok-tossed rice with fresh vegetables', price: 160, category: 'Rice & Biryani', emoji: '🍳', isVeg: true, preparationTime: 12, tags: ['quick', 'vegetarian'], stats: { totalOrdered: 95, avgRating: 4.2, ratingCount: 38, totalRevenue: 15200 } },
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  // Clear existing data
  await MenuItem.deleteMany({});
  await Table.deleteMany({});
  await User.deleteMany({});
  console.log('Cleared existing data');

  // Seed menu items with aiScore
  const items = menuItems.map(item => {
    const freqScore = Math.min(item.stats.totalOrdered / 500, 1.0);
    const ratingScore = item.stats.ratingCount === 0 ? 0.5 : (item.stats.avgRating - 1) / 4;
    const aiScore = Math.max(0, Math.min(100, Math.round((freqScore * 0.4 + ratingScore * 0.4) * 100)));
    return { ...item, aiScore, isAvailable: true };
  });
  await MenuItem.insertMany(items);
  console.log(`Seeded ${items.length} menu items`);

  // Seed 10 tables
  const tables = [];
  for (let i = 1; i <= 10; i++) {
    const sessionId = uuidv4();
    const url = `${FRONTEND_URL}/index.html?table=${i}&session=${sessionId}`;
    const qrCode = await QRCode.toDataURL(url);
    tables.push({
      tableNumber: i,
      capacity: i <= 4 ? 2 : i <= 8 ? 4 : 6,
      status: 'available',
      currentSessionId: sessionId,
      qrCode,
      location: i <= 4 ? 'indoor' : i <= 8 ? 'outdoor' : 'terrace',
      activeOrderCount: 0,
    });
  }
  await Table.insertMany(tables);
  console.log('Seeded 10 tables');

  // Seed admin user
  await User.create({
    name: 'Admin User',
    email: 'admin@tableqr.com',
    password: 'admin1234',
    role: 'admin',
  });
  await User.create({
    name: 'Kitchen Staff',
    email: 'kitchen@tableqr.com',
    password: 'kitchen1234',
    role: 'kitchen',
  });
  console.log('Seeded users: admin@tableqr.com / admin1234, kitchen@tableqr.com / kitchen1234');

  console.log('\n✅ Seed complete! Open http://localhost:3000/index.html?table=1&session=' + tables[0].currentSessionId);
  await mongoose.disconnect();
}

seed().catch(err => { console.error(err); process.exit(1); });
