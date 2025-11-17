require('dotenv').config();

const express = require('express');
const app = express();
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb')
const methodOverride = require('method-override')
const session = require('express-session')
const passport = require('passport')
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt') 
const MongoStore = require('connect-mongo')


app.set('view engine','ejs')
app.set('views', path.join(__dirname, 'views')) //안적어도 됨 views 폴더가 기본값이라서
app.use(express.static(path.join(__dirname, '..','client')));
app.use(methodOverride('_method'))
app.use(express.urlencoded({extended:true}))
app.use(passport.initialize())
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave : false,
  saveUninitialized : false,
  cookie : {maxAge : 60 * 60 * 1000},
  store : MongoStore.create({
     mongoUrl: process.env.MONGO_URL, 
     dbName: process.env.DB_NAME
     })
}))
app.use(passport.session())
app.use(express.json())

let db
const url = process.env.MONGO_URL; 
const dbName = process.env.DB_NAME;
const PORT = process.env.PORT || 8080;

new MongoClient(url).connect().then((client)=>{
  console.log('DB연결성공')
  db = client.db(dbName) 
  app.listen(8080, () => {
    console.log('http://localhost:8080 에서 서버 실행중')
})
}).catch((err)=>{
  console.log(err)
})

//localhost 접속시 index창 출력
app.get('/', (req , res)=> {
    res.sendFile('index.html',{ root:path.join(__dirname, '../client')});
})

//회원가입

app.post('/register', async (req, res) => {
  let hash = await bcrypt.hash(req.body.signup_password, 10)
  let hash2 = await bcrypt.hash(req.body.signup_password2, 10)
  try{
  await db.collection('user').insertOne({
    username : req.body.signup_email,
    nickname : req.body.signup_nickname, 
    password : hash,
    password2 : hash2
  });
  console.log('user 등록 완료', req.body.signup_email);
  return res.redirect('/?registered=1');
  }catch (err){
    console.error('회원가입 중 에러', err);
    res.status(500).send('실패하였습니다');
  }
});

//로그인

passport.use(new LocalStrategy(
  {
    usernameField: 'login_email',    // req.body.login_email
    passwordField: 'login_password', // req.body.login_password
  },
  async (입력한아이디, 입력한비번, done) => {
    try {
      const result = await db.collection('user').findOne({ username: 입력한아이디 });

      if (!result) {
        return done(null, false, { message: '아이디 DB에 없음' });
      }

      const passOk = await bcrypt.compare(입력한비번, result.password);
      if (!passOk) {
        return done(null, false, { message: '비번 불일치' });
      }

      return done(null, result);

    } catch (err) {
      console.error(err);
      return done(err);
    }
  }
));

//세션에 뭐 저장할지 정하는 부분
passport.serializeUser((user, done) => {
  console.log(user)
  process.nextTick(() => {
    done(null, { id: user._id, username: user.username })
  })
})
//세션에 있는 걸로 진짜 유저 찾기
passport.deserializeUser(async (user, done) => {
  let result = await db.collection('user').findOne({_id : new ObjectId(user.id) })
  delete result.password
  process.nextTick(() => {
    return done(null, result)
  })
})

app.post('/login', (req, res, next) => {
  passport.authenticate('local', (error, user, info) => {
    if (error) {
      console.error(error);
      return next(error);
    }

    if (!user) {
      return res.status(401).json({ message: info?.message || '로그인 실패' });
    }

    req.login(user, (err) => {
      if (err) {
        console.error(err);
        return next(err);
      }
      return res.redirect('/list');
    });
  })(req, res, next);
});

//로그인 check 미들웨어

function 로그인필요(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  return res.redirect('/?login=required');
}

// 게시글 작성

app.post('/post', 로그인필요, async (req, res) => {
  try {
    await db.collection('post').insertOne({
      title: req.body.title,
      content: req.body.content,
      authorId: req.user._id,
      authorName: req.user.nickname,
      createdAt: new Date()
    })

    res. redirect('/list')
  } catch (err) {
    console.log('글 작성 중 에러:', err)
    res.status(500).send('글 작성 중 오류가 발생했습니다')
  }
})

//게시글 목록

app.get('/list', 로그인필요, async (req, res) => {
  try{
    const posts = await db.collection('post')
    .find()
    .sort({ _id : -1 })
    .toArray();

    res.render('list.ejs', {
      user: req.user,
      posts: posts
    })
  } catch (err) {
    console.error('글 목록 조회 중 에러:', err)
    res.status(500).send('글 목록을 불러오는 중 오류가 발생하였습니다')
  }
})

//상세페이지

app.get('/detail/:id', 로그인필요, async(req, res) => {
  try{
    const postId = req.params.id;
    const post = await db.collection('post').findOne({
      _id: new ObjectId(postId)
    })
    if(!post){
      return res.status(404).send('해당 글을 찾을 수 없습니다')
    }
    
    res.render('detail.ejs', {
      user: req.user,
      post: post
    })
  }catch (err) {
    console.error('글 삭제 조회 중 에러', err)
    res.status(500).send('글 상세 조회 중 오류가 발생했습니다')
  }
})

// 글 수정 페이지
app.get('/post/:id/edit', 로그인필요, async (req, res) => {
  try {
    const postId = req.params.id;
    const post = await db.collection('post').findOne({
      _id: new ObjectId(postId)
    });

    if (!post) {
      return res.status(404).send('해당 글을 찾을 수 없습니다.');
    }

    res.render('edit.ejs', {
      user: req.user,
      post: post
    });
  } catch (err) {
    console.error('글 수정 페이지 에러:', err);
    res.status(500).send('글 수정 페이지 로드 중 오류가 발생했습니다.');
  }
});
// 글 수정 처리
app.put('/post/:id', 로그인필요, async (req, res) => {
  try {
    const postId = req.params.id;

    await db.collection('post').updateOne(
      { _id: new ObjectId(postId) },
      {
        $set: {
          title: req.body.title,
          content: req.body.content
        }
      }
    );
      res.redirect('/detail/' + postId);
  } catch (err) {
    console.error('글 수정 중 에러:', err);
    res.status(500).send('글 수정 중 오류가 발생했습니다.');
  }
});
// 글 삭제 처리
app.delete('/post/:id', 로그인필요, async (req, res) => {
  try {
    const postId = req.params.id;

    await db.collection('post').deleteOne({
      _id: new ObjectId(postId)
    });

    res.redirect('/list');
  } catch (err) {
    console.error('글 삭제 중 에러:', err);
    res.status(500).send('글 삭제 중 오류가 발생했습니다.');
  }
});
  


//로그아웃

app.post('/logout', (req, res, next) => {
  req.logout((err) => {     
    if (err) {
      return next(err);
    }
    res.redirect('/');
  });
});
