const express = require('express');
const router = express.Router();
const User = require('../models/User');
const DirectMessage = require('../models/DirectMessage');
const { authenticate } = require('../middleware/auth');



// Search Users
router.get('/search', authenticate, async (req, res) => {
    try {
        const { query } = req.query;
        if (!query || query.length < 2) {
            return res.json({ users: [] });
        }

        // Find users matching query, exclude self
        const users = await User.find({
            username: { $regex: query, $options: 'i' },
            _id: { $ne: req.user.userId }
        })
        .select('username blitzRating role')
        .limit(5);

        res.json({ users });
    } catch (err) {
        console.error('Error searching users:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get Friends List
router.get('/', authenticate, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).populate('friends', 'username blitzRating role');
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        res.json({ friends: user.friends });
    } catch (err) {
        console.error('Error fetching friends:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get Friend Requests
router.get('/requests', authenticate, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).populate('friendRequests.from', 'username blitzRating');
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        const pendingRequests = user.friendRequests.filter(req => req.status === 'pending');
        res.json({ requests: pendingRequests });
    } catch (err) {
        console.error('Error fetching requests:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Send Friend Request
router.post('/request', authenticate, async (req, res) => {
    try {
        const { targetUsername } = req.body;
        console.log(`Attempting to add friend: "${targetUsername}" from user ID: ${req.user.userId}`);
        
        // Exact match with trim and case-insensitivity
        const targetUser = await User.findOne({ 
            username: { $regex: new RegExp(`^${targetUsername.trim()}$`, 'i') } 
        });
        
        if (!targetUser) return res.status(404).json({ error: 'User not found' });
        if (targetUser._id.toString() === req.user.userId) {
            return res.status(400).json({ error: 'Cannot add yourself' });
        }

        const me = await User.findById(req.user.userId);
        if (!me) return res.status(404).json({ error: 'Your account was not found' });
        
        if (me.friends && me.friends.includes(targetUser._id)) {
            return res.status(400).json({ error: 'Already friends' });
        }

        const existingRequest = targetUser.friendRequests.find(
            r => r.from.toString() === req.user.userId && r.status === 'pending'
        );

        if (existingRequest) {
            return res.status(400).json({ error: 'Request already sent' });
        }

        targetUser.friendRequests.push({ from: req.user.userId, status: 'pending' });
        await targetUser.save();

        res.json({ success: true, message: 'Friend request sent' });
    } catch (err) {
        console.error('Error sending friend request:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Accept/Reject Friend Request
router.post('/respond', authenticate, async (req, res) => {
    try {
        const { requestId, accept } = req.body;
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        const request = user.friendRequests.id(requestId);
        if (!request || request.status !== 'pending') {
            return res.status(400).json({ error: 'Invalid or already processed request' });
        }

        request.status = accept ? 'accepted' : 'rejected';

        if (accept) {
            if (!user.friends.includes(request.from)) {
                user.friends.push(request.from);
            }
            
            const sender = await User.findById(request.from);
            if (sender && !sender.friends.includes(user._id)) {
                sender.friends.push(user._id);
                await sender.save();
            }
        }

        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error('Error responding to request:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get Direct Messages with a specific friend
router.get('/messages/:friendId', authenticate, async (req, res) => {
    try {
        const { friendId } = req.params;
        const messages = await DirectMessage.find({
            $or: [
                { senderId: req.user.userId, receiverId: friendId },
                { senderId: friendId, receiverId: req.user.userId }
            ]
        }).sort({ createdAt: 1 }).limit(50); // Get last 50 messages
        
        res.json({ messages });
    } catch (err) {
        console.error('Error fetching messages:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
