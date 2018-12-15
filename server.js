'use strict';

// Application Dependencies
const express = require('express');
const cors = require('cors');
const superagent = require('superagent');
const pg = require('pg');

// Load env vars;
require('dotenv').config();
const PORT = process.env.PORT || 3000;
console.log(process.env);

// App
const app = express();
app.use(cors());

//postgres
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('error', err => console.log(err));

// Routes
app.get('/location', getLocation);
app.get('/weather', getWeather);
app.get('/yelp', getYelp);
app.get('/movies', getMovie);

// Handlers
function getLocation (req, res) {
  let lookupHandler = {
    cacheHit : (data) => {
      console.log('Location retreived from database');
      res.status(200).send(data.rows[0]);
    },
    cacheMiss : (query) => {
      return fetchLocation(query)
        .then(result => {
          res.send(result);
        });
    }
  };

  lookupLocation(req.query.data, lookupHandler);

}

function getWeather (req, res) {
  return searchForWeather(req.query.data)
    .then(weatherData => {
      res.send(weatherData);
    });
}

function getYelp(req, res) {
  let lookupHandler = {
    cacheHit : (data) => {
      console.log('Yelp retrieved from Database');
      res.status(200).send(data.rows[0]);// not sure how it works
    },
    cacheMiss : (query) => {
      return fetchYelp(query)
        .then(result => {
          res.send(result);
        });
    }
  };
  lookupYelp(req.query.data, lookupHandler);
}

function getMovie(req,res) {
  return searchMovie(req.query.data)
    .then(movieData => {
      res.send(movieData);
    });
}

// Error handling
function handleError(res) {
  res.status(500).send('Sorry something went wrong!');
}

// Constructor functions
function Location(location, query) {
  this.search_query = query;
  this.formatted_query = location.formatted_address;
  this.latitude = location.geometry.location.lat;
  this.longitude = location.geometry.location.lng;
}

function Daily (day) {
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toDateString();
}

function Yelp(business) {
  this.name = business.name;
  this.image_url = business.image_url;
  this.price = business.price;
  this.rating = business.rating;
  this.url = business.url;
}
function Movies(show) {
  this.title = show.title;
  this.overview = show.overview;
  this.average_votes = show.vote_average;
  this.popularity = show.votes_total;
  this.image_url = ('http://image.tmdb.org/t/p/w185/' + show.poster_path);
  this.popularity = show.popularity;
  this.released_on = show.release_date;
}

//SQL

function lookupLocation(query, handler){
  const SQL = 'SELECT * FROM locations WHERE search_query=$1';
  const values = [query];
  return client.query(SQL, values)
    .then(data => { // then if we have it, send it back;
      if (data.rowCount) {
        handler.cacheHit(data);
      } else {
        handler.cacheMiss(query);
      }
    });
}
function lookupYelp(query, handler) {
  const SQL = 'SELECT * FROM businesses WHERE search_query=$1';
  const values = [query];
  return client.query(SQL, values)
    .then(data => {
      if (data.rowCount) {
        handler.cacheHit(data);
      } else {
        handler.cacheMiss(query);
      }
    });
}

// Search Functions
function fetchLocation(query){
  // otherwise, get it from google
  const URL = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${process.env.GEOCODE_API_KEY}`;
  return superagent.get(URL)
    .then(result => {
      console.log('Location retreived from google');
      // then normalize it
      let location = new Location(result.body.results[0]);
      let SQL = `INSERT INTO locations 
            (search_query, formatted_query, latitude, longitude)
            VALUES($1, $2, $3, $4)`;
      // store it in our db
      return client.query(SQL, [query, location.formatted_query, location.latitude, location.longitude])
        .then(() => {
          return location;
        });
    });

}

function searchForWeather(query) {
  const url = `https://api.darksky.net/forecast/${process.env.DARKSKY_API_KEY}/${query.latitude},${query.longitude}`;
  return superagent.get(url)
    .then(weatherData => {
      return weatherData.body.daily.data.map(day => new Daily(day));
    })
    .catch(err => console.error(err));
}

function fetchYelp(query) {
  const url = `https://api.yelp.com/v3/businesses/search?term=restaurants&latitude=${query.latitude}&longitude=${query.longitude}`;
  return superagent.get(url)
    .set('Authorization', `Bearer ${process.env.YELP_API_KEY}`)
    .then(yelpData => {
      console.log('Yelp retreived from google');
      let yelp = yelpData.body.businesses.map(business => new Yelp(business));

      let SQL = `INSERT INTO businesses
      (name, image_url, price, rating, url)
      VALUES($1, $2, $3, $4, $5)`;

      return client.query(SQL, [yelp.name, yelp.image_url, yelp.price, yelp.rating, yelp.url])
        .then(() => {
          return yelp;
        });
    })
    .catch(err => console.error(err));
}

function searchMovie(query) {
  const url = `https://api.themoviedb.org/3/discover/movie?api_key=${process.env.MOVIE_API_KEY}`;
  return superagent.get(url)
    .then(movieData => {
      return movieData.body.results.map(show => new Movies(show));
    })
    .catch(err => console.error(err));
}

// Bad path
app.get('/*', function(req, res) {
  res.status(404).send('You are in the wrong place');
});


// Listen
app.listen(PORT, () => {
  console.log(`Listening on port: ${PORT}`);}
);
